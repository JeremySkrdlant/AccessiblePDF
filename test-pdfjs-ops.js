const fs = require('fs');
const pdfjsLib = require('pdfjs-dist');

async function main() {
  const data = new Uint8Array(fs.readFileSync('result pdfs/Gem_Flash_Code_41 Small-accessible.pdf'));
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const page = await doc.getPage(1);
  const ops = await page.getOperatorList();
  console.log('ops length:', ops.fnArray.length);
  const bdcIndices = [];
  for(let i=0; i<ops.fnArray.length; i++) {
     if (ops.fnArray[i] === pdfjsLib.OPS.beginMarkedContent || ops.fnArray[i] === pdfjsLib.OPS.beginMarkedContentProps || ops.fnArray[i] === pdfjsLib.OPS.markPoint || ops.fnArray[i] === pdfjsLib.OPS.markPointProps) {
        bdcIndices.push(i);
     }
  }
  console.log('BDC OPS indices:', bdcIndices);
  for(let i of bdcIndices) {
     console.log('op args at', i, ops.argsArray[i]);
  }
}
main().catch(console.error);
