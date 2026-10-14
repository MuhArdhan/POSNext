import { beforeEach, describe, expect, it, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"
import { nextTick } from "vue"

vi.hoisted(() => { globalThis.__ = (text) => text })
vi.mock("@/composables/useToast", () => ({ useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }) }))
vi.mock("@/composables/useQzTray", async () => {
	const { ref } = await import("vue")
	const state = {
		qzConnected: ref(false), qzConnecting: ref(false), qzCertStatus: ref("unknown"),
		printers: ref([]), selectedPrinter: ref("RECEIPT"), loadingPrinters: ref(false),
		printerOptions: ref([{ label: "LABEL", value: "LABEL" }]),
		certLoading: ref(false), certReady: ref(false),
		handleConnect: vi.fn(), refreshPrinters: vi.fn(), generateCertificate: vi.fn(), downloadCertificate: vi.fn(),
	}
	return { useQzTray: () => state }
})
vi.mock("@/utils/print/product_label_qz", () => ({ productLabelPrinter: { print: vi.fn() } }))
vi.mock("@/utils/print/transport", () => ({ ensureIminSdk: vi.fn(), getTransport: vi.fn(), initTransportFromServer: vi.fn(async () => {}) }))
vi.mock("@/stores/bootstrap", () => ({ useBootstrapStore: () => ({ data: { is_management: true } }) }))
vi.mock("@/stores/posSettings", () => ({ usePOSSettingsStore: () => ({ automaticStockSync: false }) }))
vi.mock("@/utils/offline/workerClient", () => ({ offlineWorker: { getStockSyncStatus: vi.fn(async () => ({})) } }))
vi.mock("@/composables/usePOSEvents", () => ({ usePOSEvents: () => ({ detectSettingsChanges: vi.fn(), updateSettingsSnapshot: vi.fn(), emitStockSyncConfigured: vi.fn() }) }))
vi.mock("frappe-ui", async () => {
	const { defineComponent } = await import("vue")
	return {
		Button: defineComponent({ template: '<button @click="$emit(\'click\')"><slot /></button>', emits: ["click"] }),
		call: vi.fn(async (method) => method.endsWith("get_warehouses") ? [] : { enabled: 1 }),
		createResource: (options) => ({ reload: vi.fn(async () => options.onSuccess?.({ enabled: 1 })) }),
	}
})

import { call } from "frappe-ui"
import { useQzTray } from "@/composables/useQzTray"
import ProductLabelSettings from "./ProductLabelSettings.vue"
import POSSettings from "./POSSettings.vue"
import { loadLabelConfig, saveLabelConfig } from "@/utils/print/product_label"

const global = { config: { globalProperties: { __: globalThis.__ } }, stubs: { RefreshButton: true, TranslatedHTML: true } }
const button = (wrapper, text) => wrapper.findAll("button").find((b) => b.text() === text)

beforeEach(() => {
	localStorage.clear()
	vi.clearAllMocks()
	useQzTray().printerOptions.value = [{ label: "LABEL", value: "LABEL" }]
})

describe("label settings persistence", () => {
	it("keeps a saved printer visible before QZ discovery, including after reopening", () => {
		saveLabelConfig("Outlet", { enabled: true, printer: "SAVED-LABEL" })
		useQzTray().printerOptions.value = []
		const wrapper = mount(ProductLabelSettings, { props: { posProfile: "Outlet" }, global })
		expect(wrapper.find('input[type="checkbox"]').element.checked).toBe(true)
		expect(wrapper.find("select").element.value).toBe("SAVED-LABEL")
		expect(wrapper.text()).toContain("QZ Tray Not Connected")
		wrapper.unmount()
	})

	it("persists numeric checkbox values and printer with the dedicated label save button", async () => {
		const wrapper = mount(ProductLabelSettings, { props: { posProfile: "Outlet" }, global })
		await wrapper.find('input[type="checkbox"]').setValue(true)
		await wrapper.find("select").setValue("LABEL")
		await button(wrapper, "Save Label Settings").trigger("click")
		expect(loadLabelConfig("Outlet")).toMatchObject({ enabled: true, printer: "LABEL" })
		wrapper.unmount()
	})

	it("main Save Settings persists label edits even after switching away from Printing", async () => {
		const wrapper = mount(POSSettings, { props: { modelValue: true, embedded: true, posProfile: "Outlet" }, global })
		await flushPromises()
		await button(wrapper, "Printing").trigger("click")
		const labels = wrapper.findComponent(ProductLabelSettings)
		await labels.find('input[type="checkbox"]').setValue(true)
		await labels.find("select").setValue("LABEL")
		await button(wrapper, "Stock Management").trigger("click")
		expect(wrapper.findComponent(ProductLabelSettings).exists()).toBe(false)
		await wrapper.vm.$.setupState.saveSettings()
		await nextTick()
		expect(loadLabelConfig("Outlet")).toMatchObject({ enabled: true, printer: "LABEL" })
		const payload = call.mock.calls.find(([method]) => method.endsWith("update_pos_settings"))[1].settings
		expect(payload).not.toHaveProperty("printer")
		expect(payload).not.toHaveProperty("productLabelConfig")
		await button(wrapper, "Printing").trigger("click")
		expect(wrapper.findComponent(ProductLabelSettings).find("select").element.value).toBe("LABEL")
		wrapper.unmount()
	})
})
