import fs from 'fs';
import { PDFDocument, PDFDict, PDFName, PDFArray } from 'pdf-lib';

async function main() {
  const bytes = fs.readFileSync('result pdfs/Tree-Flash_Code_41 Small-accessible.pdf');
  const doc = await PDFDocument.load(bytes);
  console.log("Document loaded.");
  
  const catalog = doc.catalog;
  console.log("Catalog keys:");
  for (const [key, value] of catalog.dict.entries()) {
     console.log(key.name);
  }

  const vp = catalog.get(PDFName.of('ViewerPreferences'));
  if (vp instanceof PDFDict) {
    console.log("ViewerPreferences:");
    for (const [key, value] of vp.dict.entries()) {
       console.log(key.name, value.toString());
    }
  } else {
    console.log("No ViewerPreferences!");
  }

  const structTreeRootRef = catalog.get(PDFName.of('StructTreeRoot'));
  const structTreeRoot = doc.context.lookup(structTreeRootRef);
  if (!structTreeRoot) {
    console.log("No struct tree root found!");
  } else {
    console.log("StructTreeRoot found.");
  }
}
main().catch(e => console.error(e));
