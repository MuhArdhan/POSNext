/** Product labels are an independent lane: no receipt settings or transport. */
import { escapeHtml } from "@/utils/escapeHtml"

export const LABEL_DEFAULTS = Object.freeze({
	enabled: false,
	printer: "",
	width: 60,
	height: 50,
	margin: 3,
	fontSize: 10,
	productFontSize: 16,
	lineHeight: 1.2,
	align: "left",
	showCompany: true,
	showCustomer: true,
	showQueue: true,
	showInvoice: true,
	showDate: true,
	showNotes: true,
	footer: "",
	itemGroups: "",
})

const KEY = "pos_product_label_config_v1:"
const numericLimits = {
	width: [20, 120], height: [20, 150], margin: [0, 8],
	fontSize: [6, 18], productFontSize: [10, 30], lineHeight: [1, 2],
}

export function normalizeLabelConfig(raw = {}) {
	const config = { ...LABEL_DEFAULTS }
	for (const key of Object.keys(config)) {
		if (raw[key] == null) continue
		if (numericLimits[key]) {
			const n = Number(raw[key])
			const [min, max] = numericLimits[key]
			if (Number.isFinite(n) && raw[key] !== "") config[key] = Math.min(max, Math.max(min, n))
		} else if (typeof config[key] === "boolean") {
			config[key] = raw[key] === true || raw[key] === 1
		} else {
			config[key] = String(raw[key]).slice(0, key === "itemGroups" ? 1000 : 200)
		}
	}
	if (!["left", "center", "right"].includes(config.align)) config.align = "left"
	return config
}

export function loadLabelConfig(profile) {
	try {
		return normalizeLabelConfig(JSON.parse(localStorage.getItem(KEY + (profile || "")) || "{}"))
	} catch {
		return normalizeLabelConfig()
	}
}

export function saveLabelConfig(profile, config) {
	if (!profile) throw new Error("Select a POS Profile before saving label settings")
	const next = normalizeLabelConfig(config)
	localStorage.setItem(KEY + profile, JSON.stringify(next))
	return next
}

/** One label per whole unit; package containers are not physical products. */
export function expandProductLabels(invoice, rawConfig = {}) {
	if (invoice?.is_return || invoice?.doctype === "Sales Order") return []
	const config = normalizeLabelConfig(rawConfig)
	const groups = config.itemGroups.split("\n").map((s) => s.trim()).filter(Boolean)
	const labels = []
	for (const item of invoice?.items || []) {
		if ((item.pos_package_role || item.package_role) === "Package") continue
		if (groups.length && !groups.includes(item.item_group)) continue
		const qty = Number(item.qty ?? item.quantity ?? 0)
		if (qty <= 0) continue
		if (!Number.isSafeInteger(qty)) throw new Error("Product labels require whole-number quantities")
		if (labels.length + qty > 200) throw new Error("Maximum 200 product labels per print job")
		for (let unit = 1; unit <= qty; unit++) labels.push({ item, unit, quantity: qty })
	}
	return labels.map((label, index) => ({ ...label, index: index + 1, total: labels.length }))
}

export function buildProductLabelHTML(invoice, label, rawConfig = {}) {
	const c = normalizeLabelConfig(rawConfig)
	const text = (value) => escapeHtml(value ?? "")
	const row = (value, className = "") => value ? `<div class="${className}">${text(value)}</div>` : ""
	const party = invoice.buyer_name || invoice.customer_name || invoice.customer
	const queue = invoice.pos_queue_number != null && invoice.pos_queue_number !== ""
		? `#${String(invoice.pos_queue_number).padStart(3, "0")}` : ""
	// Descriptions may contain rich text; never interpret it as label markup.
	const notes = String(label.item.notes || label.item.description || "").replace(/<[^>]*>/g, " ").trim().slice(0, 180)
	return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
		@page { size: ${c.width}mm ${c.height}mm; margin: 0; }
		* { box-sizing: border-box; }
		html, body { width: ${c.width}mm; height: ${c.height}mm; margin: 0; padding: 0; }
		.label { width: ${c.width}mm; height: ${c.height}mm; padding: ${c.margin}mm;
			font-family: Arial, sans-serif; font-size: ${c.fontSize}pt; line-height: ${c.lineHeight};
			text-align: ${c.align}; overflow: hidden; color: #000; overflow-wrap: anywhere; }
		.product { font-size: ${c.productFontSize}pt; font-weight: bold; margin: 2mm 0; }
		.heading { font-weight: bold; } .small { font-size: 8pt; } .notes { white-space: pre-wrap; }
	</style></head><body><div class="label">
		${c.showCompany ? row(invoice.company, "heading") : ""}
		${c.showQueue ? row(queue, "heading") : ""}
		${c.showCustomer ? row(party, "heading") : ""}
		${row(label.item.item_name || label.item.item_code, "product")}
		${c.showNotes ? row(notes, "notes") : ""}
		${row(`${label.index}/${label.total}`, "small")}
		${c.showInvoice ? row(invoice.name, "small") : ""}
		${c.showDate ? row([invoice.posting_date, String(invoice.posting_time || "").split(".")[0]].filter(Boolean).join(" "), "small") : ""}
		${row(c.footer, "small")}
	</div></body></html>`
}

export const SAMPLE_LABEL_INVOICE = {
	name: "POS-00001", company: "Coffee Shop", buyer_name: "Ardhan",
	pos_queue_number: 12, posting_date: "2026-10-13", posting_time: "10:30:00",
	items: [{ item_name: "Iced Caramel Latte", item_code: "LATTE", qty: 1, notes: "Less sugar · Extra ice" }],
}
