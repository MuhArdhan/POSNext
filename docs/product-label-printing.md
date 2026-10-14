# Product labels (QZ Tray)

Product labels are an opt-in print lane, independent of receipt printing. No
database schema, invoice API, receipt driver or receipt fallback is changed.

## Setup

1. Install the label printer's Windows driver and QZ Tray on the cashier PC.
2. Configure the printer driver for **60 mm width × 50 mm height**, gap media,
   portrait orientation, and calibrate the sensor using the manufacturer's tool.
3. Configure the existing QZ certificate from POS Settings if required.
4. Open **POS Settings → Printing → Product Labels — QZ Tray**.
5. Connect/refresh printers and choose a dedicated label printer. This selection
   does not replace the receipt printer.
6. Adjust paper dimensions, margins, typography, alignment, visible information,
   footer text, and optional exact Item Group names (one name per line).
7. Print a test label, then enable automatic labels and click **Save Label Settings**
   or the main **Save Settings** button. The main button also saves label edits
   after switching tabs; drafts remain in the settings panel until saved.

The live preview and test print use the current form. Checkout uses only saved
settings. Settings are stored per POS Profile in this browser's localStorage;
they do not sync to other computers and are removed when browser storage is cleared.
The saved printer name stays visible even before QZ printer discovery completes;
it does not mean that the printer is currently connected.

## Checkout

- Labels are dispatched after a submitted, fully paid online sale, or a fully
  paid sale successfully saved to the offline queue. Offline labels are not
  automatically reprinted on sync. Credit sales, unpaid/partial payments,
  returns and Sales Orders do not trigger this lane.
- Each whole product unit gets one label, numbered across the print job. Package
  containers are omitted; their physical component rows get labels.
- Fractional quantities and jobs larger than 200 labels raise a label warning,
  not a payment error. Use the Item Group filter to exclude non-unit products.
- Each label is a fixed-size HTML pixel page in one QZ job. No ZPL/TSPL is sent.
- Names and label text are HTML-escaped. Notes use existing item notes/description;
  this feature does not add a new order modifier editor.
- QZ failure never invokes the receipt printer, iMin, or browser fallback.
- The checkout success dialog shows dispatch status and a **Print Product Labels**
  button. Reprints require confirmation: a printer may have partially printed
  even when QZ reports failure. There are no automatic retries.
- Success means QZ accepted the job, not that physical label output was verified.
  Check actual printer output, media feed and text clipping during commissioning.

Keep the receipt QZ printer different from the label printer, especially when
iMin receipt fallback is enabled. This feature does not change existing fallback
behavior. QZ Tray requires a supported desktop OS; Android integration is separate.

## Files

- `POS/src/utils/print/product_label.js`: isolated configuration and pure layout.
- `POS/src/utils/print/product_label_qz.js`: serialized, dedicated QZ dispatch.
- `POS/src/components/settings/ProductLabelSettings.vue`: configuration/preview.
- `POS/src/pages/POSSale.vue`: additive checkout hook and explicit reprint action.

Tests include layout, escaping, per-unit labels, dispatch deduplication,
serialization, retry behavior and online/offline checkout safety.
