import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';

async function convert(ndjsonPath) {
  if (!ndjsonPath || !fs.existsSync(ndjsonPath)) {
    console.error('Usage: node scripts/convert-ndjson-to-csv.js <path-to-backup.ndjson>');
    process.exit(1);
  }

  const outDir = path.dirname(ndjsonPath);
  const baseName = path.basename(ndjsonPath, path.extname(ndjsonPath));
  const patientsCsvPath = path.join(outDir, `${baseName}_customers_patients.csv`);
  const invoicesCsvPath = path.join(outDir, `${baseName}_invoices.csv`);

  console.log(`Reading NDJSON: ${ndjsonPath}`);

  const patients = [];
  const invoices = [];

  const fileStream = fs.createReadStream(ndjsonPath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === 'record') {
        if (parsed.collection === 'patients') {
          patients.push(parsed.document);
        } else if (parsed.collection === 'invoices') {
          invoices.push(parsed.document);
        }
      }
    } catch {
      // skip invalid lines
    }
  }

  console.log(`Found ${patients.length} patients and ${invoices.length} invoices`);

  // Write Patients CSV (with UTF-8 BOM)
  const patientHeaders = ['UHID', 'First Name', 'Last Name', 'Phone', 'Gender', 'Age', 'DOB', 'Blood Group', 'Category', 'Address', 'City', 'Registration Date'];
  const patientRows = patients.map(p => [
    `"${p.uhid || ''}"`,
    `"${String(p.firstName || '').replace(/"/g, '""')}"`,
    `"${String(p.lastName || '').replace(/"/g, '""')}"`,
    `"${String(p.phone || '')}"`,
    p.gender || '',
    p.age || '',
    p.dob ? new Date(p.dob).toISOString().slice(0, 10) : '',
    p.bloodGroup || '',
    p.category || 'GENERAL',
    `"${String(p.address || '').replace(/"/g, '""')}"`,
    `"${String(p.city || '').replace(/"/g, '""')}"`,
    p.createdAt ? new Date(p.createdAt).toLocaleDateString('en-IN') : ''
  ]);
  fs.writeFileSync(patientsCsvPath, '\uFEFF' + [patientHeaders.join(','), ...patientRows.map(r => r.join(','))].join('\r\n'), 'utf8');
  console.log(`✅ Exported Patients CSV -> ${patientsCsvPath}`);

  if (invoices.length > 0) {
    const invHeaders = ['Invoice No', 'Status', 'Grand Total', 'Paid Amount', 'Balance', 'Date'];
    const invRows = invoices.map(i => [
      `"${i.invoiceNo || ''}"`,
      i.status || '',
      i.grandTotal || 0,
      i.paidAmount || 0,
      i.balanceDue || 0,
      i.createdAt ? new Date(i.createdAt).toLocaleDateString('en-IN') : ''
    ]);
    fs.writeFileSync(invoicesCsvPath, '\uFEFF' + [invHeaders.join(','), ...invRows.map(r => r.join(','))].join('\r\n'), 'utf8');
    console.log(`✅ Exported Invoices CSV -> ${invoicesCsvPath}`);
  }

  console.log('\nAll done! You can open these files directly in Microsoft Excel or Google Sheets.');
}

const target = process.argv[2] || 'C:\\Users\\Admin\\Downloads\\svlh-backup-2026-09-15.ndjson';
convert(target).catch(console.error);






