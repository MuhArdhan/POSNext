import qz from "qz-tray"
import { connect } from "@/utils/qzTray"
import { buildProductLabelHTML, expandProductLabels, normalizeLabelConfig } from "./product_label"

/** Injectable, serialized lane. No receipt fallback and no automatic retries. */
export function createProductLabelPrinter({ connect, qz }) {
	const running = new Map()
	const dispatched = new Set()
	let tail = Promise.resolve()
	function print(invoice, rawConfig, { reprint = false } = {}) {
		const config = normalizeLabelConfig(rawConfig)
		if (!config.enabled) return Promise.resolve({ status: "disabled", count: 0 })
		if (!invoice?.name) return Promise.reject(new Error("Invoice reference is required for labels"))
		const key = `${invoice.pos_profile || ""}:${invoice.name}`
		if (running.has(key)) return running.get(key)
		if (dispatched.has(key) && !reprint) return Promise.resolve({ status: "already-sent", count: 0 })
		// Snapshot before another checkout or settings edit can mutate it.
		const doc = JSON.parse(JSON.stringify(invoice))
		const job = tail.catch(() => {}).then(async () => {
			const labels = expandProductLabels(doc, config)
			if (!labels.length) return { status: "empty", count: 0 }
			if (!config.printer.trim()) throw new Error("Select a dedicated label printer in POS Settings → Printing")
			if (!(await connect())) throw new Error("QZ Tray is not available for label printing")
			const printerConfig = qz.configs.create(config.printer, {
				size: { width: config.width, height: config.height }, units: "mm",
				orientation: "portrait", margins: 0, colorType: "grayscale", scaleContent: false,
			})
			// Each data entry is one fixed-size label page; one atomic QZ job.
			await qz.print(printerConfig, labels.map((label) => ({
				type: "pixel", format: "html", flavor: "plain",
				data: buildProductLabelHTML(doc, label, config),
			})))
			dispatched.add(key)
			if (dispatched.size > 100) dispatched.delete(dispatched.values().next().value)
			return { status: "sent", count: labels.length }
		}).finally(() => running.delete(key))
		running.set(key, job)
		tail = job
		return job
	}
	return { print }
}

export const productLabelPrinter = createProductLabelPrinter({ connect, qz })
