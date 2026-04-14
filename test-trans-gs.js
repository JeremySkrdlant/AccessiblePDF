const { PDFDocument, StandardFonts, PDFName, PDFOperator } = require('pdf-lib');
const fs = require('fs');
const pdfjsLib = require('pdfjs-dist');

async function main() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([500, 500]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  
  // Create gs
  const context = doc.context;
  const extGStateDict = context.obj({ Type: 'ExtGState', ca: 0, CA: 0 });
  page.node.Resources().set(PDFName.of('ExtGState'), context.obj({ TransGS: extGStateDict }));

  page.pushOperators(
    PDFOperator.of('q'),
    PDFOperator.of('gs', [PDFName.of('TransGS')]),
    PDFOperator.of('BT'),
    PDFOperator.of('Tf', [PDFName.of(page.getFontDictionaryName(font.ref)), doc.context.obj(24)]),
    PDFOperator.of('Tm', [doc.context.obj(1), doc.context.obj(0), doc.context.obj(0), doc.context.obj(1), doc.context.obj(100), doc.context.obj(100)]),
    PDFOperator.of('Tj', [PDFName.of("Hello Invisible World")]), // actually need to encode text properly
  );
  page.drawText("Hello Transparent", { x: 100, y: 150, size: 24, font });
  page.pushOperators(
    PDFOperator.of('ET'),
    PDFOperator.of('Q')
  );

  const bytes = await doc.save();
  fs.writeFileSync('test-trans.pdf', bytes);

  const testDoc = await pdfjsLib.getDocument({ data: bytes }).promise;
  const testPage = await testDoc.getPage(1);
  const tc = await testPage.getTextContent();
  console.log('Extracted text:', tc.items.map(t => t.str));
}
main().catch(console.error);
