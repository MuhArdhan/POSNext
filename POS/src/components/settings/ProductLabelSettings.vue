<template>
	<div class="p-4 rounded-lg border border-indigo-200 bg-indigo-50">
		<h4 class="text-sm font-semibold text-gray-900 mb-2">{{ __("Product Labels — QZ Tray") }}</h4>
		<p class="text-xs text-gray-600 mb-3">{{ __("Separate from receipt printing. Saved for this POS Profile on this browser/device only.") }}</p>
		<CheckboxField v-model="config.enabled" :label="__('Print product labels after full payment')" />
		<div class="flex flex-wrap gap-2 my-2">
			<Button :loading="loadingPrinters" @click="refreshPrinters">{{ __("Connect / Refresh Label Printers") }}</Button>
			<span class="text-xs self-center">{{ qzConnected ? __("QZ Tray Connected") : __("QZ Tray Not Connected") }}</span>
		</div>
		<SelectField v-model="config.printer" :label="__('Label Printer (not receipt printer)')" :options="labelPrinterOptions" />
		<p v-if="config.printer && config.printer === selectedPrinter" class="text-xs text-amber-700 my-2">{{ __("This is also selected for receipts. Use a different printer or disable receipt fallback to avoid printing receipts on labels.") }}</p>
		<div class="grid grid-cols-2 gap-2">
			<NumberField v-for="field in numberFields" :key="field.key" v-model="config[field.key]" :label="__(field.label)" :min="field.min" :max="field.max" :step="field.step || 1" />
		</div>
		<SelectField v-model="config.align" :label="__('Alignment')" :options="[{ label: __('Left'), value: 'left' }, { label: __('Center'), value: 'center' }, { label: __('Right'), value: 'right' }]" />
		<div class="grid grid-cols-2 gap-1">
			<CheckboxField v-for="field in visibilityFields" :key="field.key" v-model="config[field.key]" :label="__(field.label)" />
		</div>
		<label class="block text-sm mt-3">{{ __("Footer text") }}<input v-model="config.footer" maxlength="200" class="block w-full border rounded p-2 text-sm" /></label>
		<label class="block text-sm mt-3">{{ __("Item Groups (one exact name per line; empty = all products)") }}<textarea v-model="config.itemGroups" maxlength="1000" rows="2" class="block w-full border rounded p-2 text-sm" /></label>
		<p class="text-xs text-gray-600 my-3">{{ __("One label per whole unit. Package containers, returns, unpaid sales and Sales Orders are excluded. Set the same paper size and gap sensor in the printer driver.") }}</p>
		<div class="flex flex-wrap gap-2 my-3">
			<Button variant="solid" @click="save">{{ __("Save Label Settings") }}</Button>
			<Button :loading="testing" @click="testPrint">{{ __("Print Test Label") }}</Button>
		</div>
		<p class="text-xs text-gray-600 mb-2">{{ __("Live layout preview (long text may be clipped; check a physical test label)") }}</p>
		<iframe title="Product label preview" sandbox="" :srcdoc="preview" :style="{ width: `${normalized.width}mm`, height: `${normalized.height}mm` }" class="border border-gray-300 bg-white max-w-full" />
	</div>
</template>

<script setup>
import { computed, ref, watch } from "vue"
import { Button } from "frappe-ui"
import CheckboxField from "./CheckboxField.vue"
import NumberField from "./NumberField.vue"
import SelectField from "./SelectField.vue"
import { useQzTray } from "@/composables/useQzTray"
import { useToast } from "@/composables/useToast"
import { __ } from "@/utils/translation"
import { buildProductLabelHTML, loadLabelConfig, normalizeLabelConfig, saveLabelConfig, SAMPLE_LABEL_INVOICE } from "@/utils/print/product_label"
import { productLabelPrinter } from "@/utils/print/product_label_qz"

const props = defineProps({ posProfile: String, modelValue: Object })
const emit = defineEmits(["update:modelValue"])
const { qzConnected, loadingPrinters, printerOptions, selectedPrinter, refreshPrinters } = useQzTray()
const { showSuccess, showError } = useToast()
const localConfig = ref(loadLabelConfig(props.posProfile))
// The parent owns drafts so switching tabs does not discard unsaved label edits.
const config = computed({
	get: () => props.modelValue || localConfig.value,
	set: (value) => {
		localConfig.value = value
		emit("update:modelValue", value)
	},
})
// Discovery may be empty while QZ is offline. Keep the saved name visible;
// displaying it is not a claim that the printer is currently connected.
const labelPrinterOptions = computed(() => {
	const options = printerOptions.value || []
	const saved = config.value.printer
	return saved && !options.some((option) => option.value === saved)
		? [...options, { label: saved, value: saved }]
		: options
})
const testing = ref(false)
watch(() => props.posProfile, (profile) => { localConfig.value = loadLabelConfig(profile) })
const normalized = computed(() => normalizeLabelConfig(config.value))
const preview = computed(() => buildProductLabelHTML(SAMPLE_LABEL_INVOICE, { item: SAMPLE_LABEL_INVOICE.items[0], index: 1, total: 1 }, normalized.value))
const numberFields = [
	{ key: "width", label: "Label Width (mm)", min: 20, max: 120 },
	{ key: "height", label: "Label Height (mm)", min: 20, max: 150 },
	{ key: "margin", label: "Margin (mm)", min: 0, max: 8, step: 0.5 },
	{ key: "fontSize", label: "Text Size (pt)", min: 6, max: 18 },
	{ key: "productFontSize", label: "Product Name Size (pt)", min: 10, max: 30 },
	{ key: "lineHeight", label: "Line Spacing", min: 1, max: 2, step: 0.1 },
]
const visibilityFields = [
	{ key: "showCompany", label: "Show Company" }, { key: "showCustomer", label: "Show Buyer / Customer" },
	{ key: "showQueue", label: "Show Queue Number" }, { key: "showInvoice", label: "Show Invoice Number" },
	{ key: "showDate", label: "Show Date / Time" }, { key: "showNotes", label: "Show Product Notes / Description" },
]
function save() {
	try {
		config.value = saveLabelConfig(props.posProfile, config.value)
		showSuccess(__("Label settings saved on this device"))
	} catch (error) { showError(error.message) }
}
async function testPrint() {
	testing.value = true
	try {
		await productLabelPrinter.print({ ...SAMPLE_LABEL_INVOICE, pos_profile: props.posProfile, name: `TEST-LABEL-${Date.now()}` }, { ...normalized.value, enabled: true, itemGroups: "" })
		showSuccess(__("Test label sent to QZ Tray"))
	} catch (error) { showError(error.message) }
	finally { testing.value = false }
}
</script>
