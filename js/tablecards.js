// Table cards as a Word document (.docx), laid out like the club's paper
// cards: one page per group with a band per match, each fighter's points, the
// winner, warnings and a Checked column, then lines for the officials to sign.
// Bouts already fought are filled in; the rest are left blank to fill by hand.
// A .docx is a zip of XML files; it is stored uncompressed, so no library is needed.

const DOCX_GOLD = 'BF8F00';
const DOCX_SHADE = 'E7E6E6';
// Column widths in twentieths of a point, across a letter page with half-inch margins.
const DOCX_COLS = [2700, 1800, 2900, 2500, 900];

const docxEsc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function docxRun(text, { bold = false, size = 20, color = null, strike = false } = {}) {
	const props = `<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>${bold ? '<w:b/>' : ''}${strike ? '<w:strike/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}<w:sz w:val="${size}"/>`;
	return `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${docxEsc(text)}</w:t></w:r>`;
}

/** A paragraph of runs; each run is [text, options]. */
function docxPara(runs, { align = null, before = 0, after = 0, newPage = false } = {}) {
	const list = typeof runs === 'string' ? [[runs]] : runs;
	const pPr = `<w:pPr>${newPage ? '<w:pageBreakBefore/>' : ''}<w:spacing w:before="${before}" w:after="${after}"/>${align ? `<w:jc w:val="${align}"/>` : ''}</w:pPr>`;
	return `<w:p>${pPr}${list.map(([t, o]) => docxRun(t, o)).join('')}</w:p>`;
}

function docxCell(width, content, { fill = null, span = 1 } = {}) {
	const paras = Array.isArray(content) ? content.join('') : content || docxPara('');
	return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ''}<w:vAlign w:val="center"/></w:tcPr>${paras}</w:tc>`;
}

const docxRow = (cells, height = 400) => `<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="${height}"/></w:trPr>${cells.join('')}</w:tr>`;

function docxTable(rows, cols, { borders = true } = {}) {
	const line = borders ? 'w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"' : 'w:val="nil"';
	const edges = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(e => `<w:${e} ${line}/>`).join('');
	return `<w:tbl><w:tblPr><w:tblW w:w="${cols.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblBorders>${edges}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${cols.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows.join('')}</w:tbl>`;
}

function docxLogo(id) {
	// 0.9 inch square, in EMUs.
	const size = 822960;
	return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${size}" cy="${size}"/><wp:docPr id="${id}" name="The Saber Legion"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="emblem.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rLogo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${size}" cy="${size}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

const docxBlank = '________________________________';

/** One group's card. */
function docxGroup(g, { date, logo, index }) {
	const title = [g.division, g.name].filter(Boolean).join(' – ').toUpperCase();
	const type = g.robin ? `POOL – ${g.fighters.length} FIGHTERS` : `MATCHES – ${g.bouts.length}`;
	const heading = [
		docxPara([[title, { bold: true, size: 28 }]]),
		docxPara([['DATE: ', { bold: true }], [date]], { before: 60 }),
		docxPara([['TYPE: ', { bold: true }], [type]], { before: 60 }),
		docxPara([['START TIME: ', { bold: true }], ['________']], { before: 60 }),
	];
	const headCols = [1500, 9300];
	const head = docxTable([docxRow([docxCell(headCols[0], logo ? docxLogo(index + 1) : ''), docxCell(headCols[1], heading)], 1300)], headCols, { borders: false });

	const fighters = g.fighters.length
		? docxPara([['FIGHTERS   ', { bold: true }], ...g.fighters.flatMap((f, i) => [[`${i + 1} `, { bold: true, color: DOCX_GOLD }], [`${f}${i < g.fighters.length - 1 ? '     ' : ''}`]])], { before: 120, after: 120 })
		: '';

	const [cName, cPts, cWin, cWarn, cChk] = DOCX_COLS;
	const small = { size: 14 };
	const header = docxRow([
		docxCell(cName, docxPara([['NAME', { bold: true, size: 18 }]])),
		docxCell(cPts, [docxPara([['POINTS SCORED', { bold: true, size: 18 }]]), docxPara([['FOR EACH FIGHTER', small]])]),
		docxCell(cWin, [docxPara([['WINNER OF THE MATCH:', { bold: true, size: 18 }]]), docxPara([['PLEASE CHECK MARK OR WRITE OUT NAME', small]])]),
		docxCell(cWarn, [docxPara([['WARNINGS', { bold: true, size: 18 }]]), docxPara([['Record all warnings / yellow card / red card', { size: 14, color: 'C00000' }]])]),
		docxCell(cChk, docxPara([['CHECKED', { bold: true, size: 14 }]], { align: 'center' })),
	], 600);
	const rows = [header];
	for (const b of g.bouts) {
		const r = b.result;
		// A no-show match is crossed out: no points, just who didn't show.
		const crossed = r?.noShow;
		const label = `${g.name} / Match ${b.number}: ${b.fighters[0]} vs ${b.fighters[1]}`;
		const band = [[label, { bold: true, color: 'FFFFFF', strike: crossed }], ...(crossed ? [['   NO-SHOW', { bold: true, color: 'FFFFFF' }]] : [])];
		rows.push(docxRow([docxCell(DOCX_COLS.reduce((a, c) => a + c, 0), docxPara(band), { fill: DOCX_GOLD, span: 5 })], 360));
		b.fighters.forEach((f, i) => {
			const won = r && r.winner === i;
			let winner = won ? [docxPara([[`✓ ${f}`, { bold: true }]]), r.decision ? docxPara([[r.decision, small]]) : ''] : '';
			if (crossed) winner = won ? '' : docxPara([['No-show', { bold: true, color: 'C00000' }]]);
			rows.push(docxRow([
				docxCell(cName, [docxPara([['Fighter name:', { size: 12 }]]), docxPara([[f, { bold: true, strike: crossed }], ...(b.charters?.[i] ? [[`  ${b.charters[i]}`, { size: 14 }]] : [])])]),
				docxCell(cPts, docxPara([[r && !crossed ? String(r.scores[i]) : '', { bold: true, size: 24 }]], { align: 'center' }), { fill: DOCX_SHADE }),
				docxCell(cWin, winner),
				docxCell(cWarn, docxPara([[r ? r.cards[i] : '', { size: 18 }]])),
				docxCell(cChk, ''),
			], 440));
		});
	}
	const body = [index > 0 ? docxPara('', { newPage: true }) : '', head, fighters, docxTable(rows, DOCX_COLS)];

	if (g.standings?.some(s => s.played)) {
		const cols = [900, 4500, 1100, 1100, 1100, 1100];
		const cell = (w, t, bold = false) => docxCell(w, docxPara([[String(t), { bold, size: 18 }]]));
		const table = [docxRow(['PLACE', 'FIGHTER', 'WINS', 'LOSSES', 'POINTS FOR', 'AGAINST'].map((t, i) => cell(cols[i], t, true)), 320)];
		g.standings.forEach((s, i) => table.push(docxRow([cell(cols[0], `${i + 1}${s.tied ? ' (tie)' : ''}`), cell(cols[1], s.name, true), cell(cols[2], s.wins), cell(cols[3], s.losses), cell(cols[4], s.pointsFor), cell(cols[5], s.pointsAgainst)], 320)));
		body.push(docxPara([['STANDINGS', { bold: true }]], { before: 200, after: 80 }), docxTable(table, cols));
	}

	const sign = label => docxPara([[`${label} `, { bold: true }], [docxBlank]], { before: 200 });
	body.push(
		...(g.robin ? [sign('FIGHTERS ADVANCING:')] : []),
		sign('DIRECTOR:'),
		sign('TIMEKEEPER SIGNATURE:'),
		docxPara([['LINE JUDGES: ', { bold: true }], [`${docxBlank}   ${docxBlank}`]], { before: 200 }),
		sign('TABLE JUDGE SIGNATURE:'),
	);
	return body.join('');
}

function docxDocument(groups, opts) {
	const body = groups.length
		? groups.map((g, i) => docxGroup(g, { ...opts, index: i })).join('')
		: docxPara('No matchups yet.');
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

const DOCX_CRC = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();

function docxCrc32(bytes) {
	let c = 0xFFFFFFFF;
	for (const b of bytes) c = DOCX_CRC[(c ^ b) & 0xFF] ^ (c >>> 8);
	return (c ^ 0xFFFFFFFF) >>> 0;
}

/** A zip of { path: string | Uint8Array }, stored without compression. */
function docxZip(files) {
	const enc = new TextEncoder();
	const parts = [];
	const central = [];
	let offset = 0;
	for (const [path, content] of Object.entries(files)) {
		const name = enc.encode(path);
		const data = typeof content === 'string' ? enc.encode(content) : content;
		const crc = docxCrc32(data);
		const local = new DataView(new ArrayBuffer(30));
		// Signature, version 2.0, UTF-8 names, stored, a fixed 1 Jan 2020 timestamp.
		[[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, 0, 2], [12, 0x5021, 2], [14, crc, 4], [18, data.length, 4], [22, data.length, 4], [26, name.length, 2], [28, 0, 2]]
			.forEach(([at, v, n]) => (n === 4 ? local.setUint32(at, v, true) : local.setUint16(at, v, true)));
		const dir = new DataView(new ArrayBuffer(46));
		[[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, 0, 2], [14, 0x5021, 2], [16, crc, 4], [20, data.length, 4], [24, data.length, 4], [28, name.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, offset, 4]]
			.forEach(([at, v, n]) => (n === 4 ? dir.setUint32(at, v, true) : dir.setUint16(at, v, true)));
		parts.push(new Uint8Array(local.buffer), name, data);
		central.push(new Uint8Array(dir.buffer), name);
		offset += 30 + name.length + data.length;
	}
	const size = central.reduce((a, p) => a + p.length, 0);
	const end = new DataView(new ArrayBuffer(22));
	const count = Object.keys(files).length;
	[[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, count, 2], [10, count, 2], [12, size, 4], [16, offset, 4], [20, 0, 2]]
		.forEach(([at, v, n]) => (n === 4 ? end.setUint32(at, v, true) : end.setUint16(at, v, true)));
	const all = [...parts, ...central, new Uint8Array(end.buffer)];
	const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
	let at = 0;
	for (const p of all) { out.set(p, at); at += p.length; }
	return out;
}

/**
 * The table cards for these groups (from tableCardGroups) as .docx bytes.
 * `logo` is the club emblem as PNG bytes, or null to leave it out.
 */
export function tableCardsDocx(groups, { date = new Date().toISOString().slice(0, 10), logo = null } = {}) {
	const files = {
		'[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
		'_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
		'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${logo ? '<Relationship Id="rLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/emblem.png"/>' : ''}</Relationships>`,
		'word/document.xml': docxDocument(groups, { date, logo: !!logo }),
	};
	if (logo) files['word/media/emblem.png'] = logo;
	return docxZip(files);
}
