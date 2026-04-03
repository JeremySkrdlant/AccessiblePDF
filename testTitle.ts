import { PDFDocument, PDFName, PDFDict } from 'pdf-lib';

async function test() {
  const doc = await PDFDocument.create();
  doc.setTitle('Test', { showInWindowTitleBar: true });
  const catalog = doc.catalog;
  console.log("ViewerPreferences present?", catalog.get(PDFName.of('ViewerPreferences')) !== undefined);
}
test();
