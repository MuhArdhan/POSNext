import { beforeEach, describe, expect, it, vi } from "vitest"
import { buildProductLabelHTML, expandProductLabels, LABEL_DEFAULTS, loadLabelConfig, normalizeLabelConfig, saveLabelConfig } from "./product_label"

vi.mock("@/utils/qzTray", () => ({ connect: vi.fn() }))
import { createProductLabelPrinter } from "./product_label_qz"

const doc = { name: "POS-1", pos_profile: "Outlet", buyer_name: "Ardhan", items: [
	{ item_name: "Latte", qty: 2, item_group: "Drinks" },
	{ item_name: "Tea", quantity: 1, item_group: "Drinks" },
] }
const config = { ...LABEL_DEFAULTS, enabled: true, printer: "LABEL-ONLY" }

beforeEach(() => { localStorage.clear() })

describe("product label layout", () => {
	it("is opt-in, defaults to 60 × 50 mm and stores by profile without touching receipt settings", () => {
		localStorage.setItem("pos_qz_printer", "RECEIPT")
		expect(loadLabelConfig("Outlet")).toMatchObject({ enabled: false, width: 60, height: 50 })
		saveLabelConfig("Outlet", config)
		expect(loadLabelConfig("Outlet").printer).toBe("LABEL-ONLY")
		expect(loadLabelConfig("Other").enabled).toBe(false)
		expect(localStorage.getItem("pos_qz_printer")).toBe("RECEIPT")
	})
	it("recovers from corrupt local configuration and clamps layout values", () => {
		localStorage.setItem("pos_product_label_config_v1:Outlet", "invalid")
		expect(loadLabelConfig("Outlet").enabled).toBe(false)
		expect(normalizeLabelConfig({ width: -1, height: Infinity, align: "<script>", fontSize: 999 })).toMatchObject({ width: 20, height: 50, align: "left", fontSize: 18 })
	})
	it("makes one label per unit, with order-wide sequence", () => {
		const labels = expandProductLabels(doc)
		expect(labels.map((l) => [l.item.item_name, l.index, l.total])).toEqual([["Latte", 1, 3], ["Latte", 2, 3], ["Tea", 3, 3]])
	})
	it("filters exact item groups and prints package components rather than containers", () => {
		const invoice = { ...doc, items: [
			{ item_name: "Package", qty: 1, package_role: "Package", item_group: "Drinks" },
			{ item_name: "Latte", qty: 2, package_role: "Package Item", item_group: "Drinks" },
			{ item_name: "Cake", qty: 1, item_group: "Food" },
		] }
		expect(expandProductLabels(invoice, { itemGroups: "Drinks" }).map((l) => l.item.item_name)).toEqual(["Latte", "Latte"])
	})
	it("does not label returns, Sales Orders, zero or negative quantities", () => {
		expect(expandProductLabels({ ...doc, is_return: 1 })).toEqual([])
		expect(expandProductLabels({ ...doc, doctype: "Sales Order" })).toEqual([])
		expect(expandProductLabels({ items: [{ qty: 0 }, { qty: -1 }] })).toEqual([])
	})
	it("rejects fractional quantities and excessive jobs before dispatch", () => {
		expect(() => expandProductLabels({ items: [{ qty: 1.5 }] })).toThrow("whole-number")
		expect(() => expandProductLabels({ items: [{ qty: 201 }] })).toThrow("200")
	})
	it("escapes every dynamic field and renders exact size, queue, buyer and visibility controls", () => {
		const invoice = { ...doc, buyer_name: '<img src=x onerror="bad()">', pos_queue_number: 7 }
		const label = { item: { item_name: "Tea <script>bad()</script>", notes: "<b>No ice</b>" }, index: 1, total: 3 }
		const html = buildProductLabelHTML(invoice, label, { footer: "<script>footer</script>" })
		expect(html).toContain("size: 60mm 50mm")
		expect(html).toContain("#007")
		expect(html).toContain("1/3")
		expect(html).toContain("&lt;img")
		expect(html).not.toContain("<script>")
		expect(html).not.toContain("<b>")
		const hidden = buildProductLabelHTML(invoice, label, { showCustomer: false, showQueue: false, showNotes: false, showInvoice: false })
		expect(hidden).not.toContain("&lt;img")
		expect(hidden).not.toContain("#007")
		expect(hidden).not.toContain("No ice")
		expect(hidden).not.toContain("POS-1")
	})
})

function printer() {
	const connect = vi.fn().mockResolvedValue(true)
	const qz = { configs: { create: vi.fn().mockReturnValue({ printer: "LABEL-ONLY" }) }, print: vi.fn().mockResolvedValue(undefined) }
	return { connect, qz, lane: createProductLabelPrinter({ connect, qz }) }
}

describe("independent QZ label lane", () => {
	it("does nothing when disabled or when no matching products exist", async () => {
		const { lane, connect, qz } = printer()
		await expect(lane.print(doc, LABEL_DEFAULTS)).resolves.toMatchObject({ status: "disabled" })
		await expect(lane.print(doc, { ...config, itemGroups: "Food" })).resolves.toMatchObject({ status: "empty" })
		expect(connect).not.toHaveBeenCalled()
		expect(qz.print).not.toHaveBeenCalled()
	})
	it("requires an explicit label printer, never falls back to the receipt printer", async () => {
		const { lane, connect, qz } = printer()
		await expect(lane.print(doc, { ...config, printer: "" })).rejects.toThrow("dedicated label printer")
		expect(connect).not.toHaveBeenCalled()
		expect(qz.print).not.toHaveBeenCalled()
	})
	it("dispatches one fixed-size page per label in a single job", async () => {
		const { lane, qz } = printer()
		await expect(lane.print(doc, config)).resolves.toMatchObject({ status: "sent", count: 3 })
		expect(qz.configs.create).toHaveBeenCalledWith("LABEL-ONLY", expect.objectContaining({ size: { width: 60, height: 50 }, units: "mm" }))
		expect(qz.print).toHaveBeenCalledTimes(1)
		expect(qz.print.mock.calls[0][1]).toHaveLength(3)
	})
	it("coalesces repeated clicks and requires explicit reprint after successful dispatch", async () => {
		const { lane, qz } = printer()
		const first = lane.print(doc, config)
		expect(lane.print(doc, config)).toBe(first)
		await first
		await expect(lane.print(doc, config)).resolves.toMatchObject({ status: "already-sent" })
		await lane.print(doc, config, { reprint: true })
		expect(qz.print).toHaveBeenCalledTimes(2)
	})
	it("reports failure without browser/iMin fallback or automatic retry, then permits manual retry", async () => {
		const { lane, qz } = printer()
		qz.print.mockRejectedValueOnce(new Error("printer offline"))
		await expect(lane.print(doc, config)).rejects.toThrow("printer offline")
		expect(qz.print).toHaveBeenCalledTimes(1)
		await lane.print(doc, config, { reprint: true })
		expect(qz.print).toHaveBeenCalledTimes(2)
	})
	it("serializes separate invoices and snapshots cart data", async () => {
		const { lane, qz } = printer()
		let release
		qz.print.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
		const invoice = JSON.parse(JSON.stringify(doc))
		const first = lane.print(invoice, config)
		invoice.items[0].item_name = "CHANGED"
		await vi.waitFor(() => expect(qz.print).toHaveBeenCalledTimes(1))
		const second = lane.print({ ...doc, name: "POS-2" }, config)
		expect(qz.print).toHaveBeenCalledTimes(1)
		expect(qz.print.mock.calls[0][1][0].data).not.toContain("CHANGED")
		release()
		await Promise.all([first, second])
		expect(qz.print).toHaveBeenCalledTimes(2)
	})
})
