const fs = require('fs');
const pdfjsLib = require('pdfjs-dist');

async function main() {
  const bytes = new Uint8Array(fs.readFileSync('test-gen.pdf'));
  const testDoc = await pdfjsLib.getDocument({ data: bytes }).promise;
  const testPage = await testDoc.getPage(1);
  const tc = await testPage.getTextContent({ includeMarkedContent: true });
  console.log('TC items extracted length:', tc.items.length);
  for(let i=0; i<tc.items.length; i++) {
     console.log('Item', i, tc.items[i]);
  }
}
main().catch(console.error);
