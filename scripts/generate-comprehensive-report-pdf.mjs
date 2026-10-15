import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const workspaceDir = 'c:\\Users\\phamt\\OneDrive\\Desktop\\Billing_One';
const htmlFilePath = path.join(workspaceDir, 'docs', 'BILLING_ONE_HE_THONG_TOAN_DIEN_REPORT.html');
const pdfFilePath = path.join(workspaceDir, 'BILLING_ONE_HE_THONG_TOAN_DIEN_REPORT.pdf');

if (!fs.existsSync(htmlFilePath)) {
  console.error(`HTML file not found at: ${htmlFilePath}`);
  process.exit(1);
}

console.log(`Converting ${htmlFilePath} to PDF...`);
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const fileUrl = 'file:///' + htmlFilePath.replace(/\\/g, '/');

try {
  execFileSync(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-pdf-header-footer',
    `--print-to-pdf=${pdfFilePath}`,
    fileUrl
  ], { stdio: 'inherit' });

  if (fs.existsSync(pdfFilePath)) {
    const stats = fs.statSync(pdfFilePath);
    console.log(`================================================================`);
    console.log(`SUCCESS: PDF Generated Successfully!`);
    console.log(`Output Path : ${pdfFilePath}`);
    console.log(`File Size   : ${(stats.size / 1024).toFixed(1)} KB (${stats.size} bytes)`);
    console.log(`================================================================`);
  } else {
    console.error('ERROR: PDF file was not created.');
    process.exit(1);
  }
} catch (err) {
  console.error('ERROR converting to PDF:', err);
  process.exit(1);
}
