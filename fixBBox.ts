import { PDFDocument, PDFName, PDFDict, PDFArray, PDFString } from 'pdf-lib';

async function test() {
  const doc = await PDFDocument.create();
  const context = doc.context;
  const structElem = context.obj({
    Type: 'StructElem',
    S: 'Figure'
  }) as PDFDict;

  const attrDict = context.obj({
    O: 'Layout',
    BBox: [0, 0, 100, 100]
  });

  structElem.set(PDFName.of('A'), attrDict);

  console.log(structElem.toString());
}
test();
