const fs = require('fs');
const pdfjsLib = require('pdfjs-dist');

async function main() {
  const data = new Uint8Array(fs.readFileSync('result pdfs/Gem_Flash_Code_41 Small-accessible.pdf'));
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const markInfo = await doc.getMarkInfo();
  console.log('markInfo:', markInfo);

  const page = await doc.getPage(1);
  const structTree = await page.getStructTree();
  console.log('structTree top-level keys:', Object.keys(structTree || {}));
  if (structTree) {
      console.log('structTree length of children:', structTree.children?.length);
      console.log('First child:', JSON.stringify(structTree.children?.[0], null, 2));
      console.log('Second child:', JSON.stringify(structTree.children?.[1], null, 2));
  }
  
  const tc = await page.getTextContent({ includeMarkedContent: true });
  console.log('tc items length:', tc.items.length);
  const bmcItems = tc.items.filter(i => i.type === 'beginMarkedContent');
  console.log('bmcItems length:', bmcItems.length);
  if (bmcItems.length > 0) {
      console.log('first 5 bmc:', bmcItems.slice(0, 5));
  }
}
main().catch(console.error);
