// 手書きの最小PDF(ASCIIのみ)。`MOCK REPORT {recordId} v{n} {status} stage={stage}` の行を含む。
'use strict';

function buildPdf(recordId, version, status, stage, title) {
  const text = `MOCK REPORT ${recordId} v${version} ${status} stage=${stage}`;
  const stream = `BT /F1 12 Tf 50 780 Td (${text}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  // 版1.20.5(SPEC §6.12-14): 文書情報の Title(UTF-16BE の16進)
  if (title) objs.push('<< /Title <FEFF' + Array.from(String(title), (c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')).join('') + '> >>');
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R${title ? ` /Info ${objs.length} 0 R` : ''} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

module.exports = { buildPdf };
