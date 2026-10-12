import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = "/Users/pavel/Desktop/brace/.tmp/brace-deck-build/pptx";
const output = "/Users/pavel/Desktop/brace/Brace-pitch-deck.pptx";
const asset = "/Users/pavel/Desktop/brace/.github/brace-banner.png";
const PX = 9525;
const W = 1280;
const H = 720;
const C = {
  ink: "F6FAFF",
  muted: "A8B5C8",
  dim: "6E7E95",
  bg: "07111F",
  bg2: "0B1B30",
  blue: "3C9DFF",
  blue2: "1468D8",
  cyan: "7AD7FF",
  line: "1C334D",
  green: "64E2B0",
};

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function esc(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function emu(value) { return Math.round(value * PX); }
function hexColor(color, alpha = null) {
  return `<a:srgbClr val="${color}">${alpha == null ? "" : `<a:alpha val="${alpha}"/>`}</a:srgbClr>`;
}
function xfrm(x, y, w, h) {
  return `<a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm>`;
}
function noLine() { return `<a:ln><a:noFill/></a:ln>`; }
function solidFill(color, alpha = null) { return `<a:solidFill>${hexColor(color, alpha)}</a:solidFill>`; }
function shapeId(n, name) {
  return `<p:nvSpPr><p:cNvPr id="${n}" name="${esc(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>`;
}
function textRun(text, size, color, bold = false, font = "Aptos") {
  return `<a:r><a:rPr lang="en-US" sz="${size * 100}" b="${bold ? 1 : 0}">${solidFill(color)}<a:latin typeface="${font}"/></a:rPr><a:t>${esc(text)}</a:t></a:r>`;
}
function paragraph(lines, size, color, opts = {}) {
  const runs = Array.isArray(lines) ? lines.map((line) => textRun(line, size, color, opts.bold, opts.font)).join("") : textRun(lines, size, color, opts.bold, opts.font);
  const align = opts.align ? ` algn="${opts.align}"` : "";
  const bullet = opts.bullet ? `<a:pPr marL="${emu(18)}" indent="-${emu(10)}"><a:buChar char="•"/></a:pPr>` : `<a:pPr${align}/>`;
  return `<a:p>${bullet}${runs}<a:endParaRPr lang="en-US" sz="${size * 100}"/></a:p>`;
}
function textBox(n, name, x, y, w, h, paras, opts = {}) {
  const items = Array.isArray(paras) ? paras : [paras];
  const body = items.map((p) => typeof p === "string" ? paragraph(p, opts.size ?? 18, opts.color ?? C.ink, opts) : paragraph(p.text, p.size ?? opts.size ?? 18, p.color ?? opts.color ?? C.ink, { ...opts, ...p })).join("");
  const margin = opts.margin ?? 0;
  const fill = opts.fill ? solidFill(opts.fill, opts.alpha ?? null) : "<a:noFill/>";
  return `<p:sp>${shapeId(n, name)}<p:spPr>${xfrm(x, y, w, h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}${opts.line ? `<a:ln w="${opts.line.width ?? 1}"/>` : noLine()}</p:spPr><p:txBody><a:bodyPr lIns="${emu(margin)}" rIns="${emu(margin)}" tIns="${emu(margin)}" bIns="${emu(margin)}" anchor="${opts.anchor ?? "t"}" wrap="square"/><a:lstStyle/>${body}</p:txBody></p:sp>`;
}
function rect(n, name, x, y, w, h, fill, opts = {}) {
  const geom = opts.round ? "roundRect" : "rect";
  return `<p:sp>${shapeId(n, name)}<p:spPr>${xfrm(x, y, w, h)}<a:prstGeom prst="${geom}"><a:avLst/></a:prstGeom>${solidFill(fill, opts.alpha ?? null)}${opts.line ? `<a:ln w="${opts.line.width ?? 1}">${solidFill(opts.line.color ?? fill)}</a:ln>` : noLine()}</p:spPr></p:sp>`;
}
function line(n, name, x1, y1, x2, y2, color = C.blue, width = 2, arrow = false) {
  return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${n}" name="${esc(name)}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrm(x1, y1, x2 - x1, y2 - y1)}<a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="${width * 12700}">${solidFill(color)}${arrow ? `<a:tailEnd type="none"/><a:headEnd type="triangle"/>` : ""}</a:ln></p:spPr><p:style><a:lnRef idx="1"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="0"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="tx1"/></a:fontRef></p:style></p:cxnSp>`;
}
function image(n, name, x, y, w, h, relId) {
  return `<p:pic><p:nvPicPr><p:cNvPr id="${n}" name="${esc(name)}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(x, y, w, h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}
function slideXml(slideNo, content, hasImage = false) {
  const imageBlock = hasImage ? image(2, "Brace hero image", 0, 0, W, H, "rId2") : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld name="Slide ${slideNo}"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${imageBlock}${content}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}
function slideRels(hasImage = false) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>${hasImage ? `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/brace-banner.png"/>` : ""}</Relationships>`;
}
function notesXml(slideNo, sourceLines) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder"/><p:cNvSpPr txBox="1"/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p>${textRun("[Sources]", 12, C.dim, true)}<a:endParaRPr/></a:p>${sourceLines.map((x) => `<a:p>${textRun(x, 11, C.muted)}<a:endParaRPr/></a:p>`).join("")}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
}
function notesRels(slideNo) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../slides/slide${slideNo}.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="../notesMasters/notesMaster1.xml"/></Relationships>`;
}
function write(file, data) { ensureDir(path.dirname(file)); fs.writeFileSync(file, data); }

function base(slideNo, title, kicker = "BRACE / POLICY-CONSTRAINED LIQUIDATION DEFENSE") {
  return [
    rect(1, "Background", 0, 0, W, H, C.bg),
    textBox(10, "Kicker", 72, 44, 920, 24, kicker, { size: 12, color: C.cyan, bold: true }),
    textBox(11, "Title", 72, 88, 1110, 78, title, { size: 38, color: C.ink, bold: true }),
    line(12, "Title rule", 72, 178, 1208, 178, C.line, 1),
    textBox(13, "Slide number", 1168, 666, 40, 22, String(slideNo).padStart(2, "0"), { size: 11, color: C.dim, bold: true, align: "right" }),
  ];
}

const slides = [];
slides.push({ image: true, sources: ["Repository asset: .github/brace-banner.png", "Repository positioning: README.md"], content: [
  rect(3, "Hero overlay", 0, 0, 620, H, C.bg, { alpha: 78000 }),
  textBox(4, "Brand", 72, 74, 520, 60, "BRACE", { size: 48, color: C.ink, bold: true }),
  textBox(5, "Hero title", 72, 188, 520, 150, "The control layer for liquidation risk.", { size: 42, color: C.ink, bold: true }),
  textBox(6, "Hero subhead", 72, 372, 460, 90, "Policy-constrained automation for Kamino positions on Solana.", { size: 21, color: C.muted }),
  line(7, "Accent", 72, 500, 260, 500, C.blue, 4),
  textBox(8, "Meta", 72, 526, 500, 48, "DEVNET PRODUCT DEMO  /  2026", { size: 12, color: C.cyan, bold: true }),
]});

slides.push({ sources: ["README.md: Problem and solution"], content: [
  ...base(2, "The hard part isn’t a price alert. It’s authority."),
  textBox(20, "Lead", 72, 222, 480, 74, "A position can cross its liquidation threshold while its owner is offline.", { size: 25, color: C.ink, bold: true }),
  textBox(21, "Body", 72, 318, 460, 120, "An alert creates awareness. The owner still has to notice, open a wallet, and act in time.", { size: 19, color: C.muted }),
  rect(30, "Risk rail", 650, 222, 4, 296, C.blue),
  textBox(31, "Step 1", 690, 226, 410, 70, "01  PRICE MOVES", { size: 15, color: C.cyan, bold: true }),
  textBox(32, "Step 1 body", 690, 265, 410, 50, "LTV approaches the edge.", { size: 21, color: C.ink, bold: true }),
  line(33, "Arrow 1", 760, 320, 760, 360, C.blue, 2, true),
  textBox(34, "Step 2", 690, 364, 410, 70, "02  OWNER IS AWAY", { size: 15, color: C.cyan, bold: true }),
  textBox(35, "Step 2 body", 690, 403, 410, 50, "The decision window narrows.", { size: 21, color: C.ink, bold: true }),
  line(36, "Arrow 2", 760, 458, 760, 498, C.blue, 2, true),
  textBox(37, "Step 3", 690, 502, 410, 70, "03  LIQUIDATION", { size: 15, color: C.cyan, bold: true }),
  textBox(38, "Step 3 body", 690, 541, 410, 50, "The protocol acts before the owner can.", { size: 21, color: C.ink, bold: true }),
]});

slides.push({ sources: ["README.md: Problem and solution", "README.md: Security model"], content: [
  ...base(3, "Brace turns a user’s rule into a narrow on-chain action."),
  textBox(20, "Quote", 72, 230, 1050, 82, "“At 80% LTV, repay toward 70% — using only the reserve I funded.”", { size: 30, color: C.ink, bold: true }),
  line(21, "Quote accent", 72, 338, 214, 338, C.blue, 4),
  textBox(22, "Owner", 72, 392, 300, 44, "OWNER SETS THE BOUNDARY", { size: 13, color: C.cyan, bold: true }),
  textBox(23, "Owner body", 72, 432, 290, 96, "Trigger, target, cap, cooldown, window, and expiry.", { size: 20, color: C.ink, bold: true }),
  textBox(24, "Reserve", 470, 392, 300, 44, "RESERVE FUNDS THE RESPONSE", { size: 13, color: C.cyan, bold: true }),
  textBox(25, "Reserve body", 470, 432, 290, 96, "The agent can draw only from the reserve the owner funded.", { size: 20, color: C.ink, bold: true }),
  textBox(26, "Agent", 868, 392, 300, 44, "AGENT SUBMITS THE REQUEST", { size: 13, color: C.cyan, bold: true }),
  textBox(27, "Agent body", 868, 432, 290, 96, "The program decides whether it is allowed to execute.", { size: 20, color: C.ink, bold: true }),
]});

slides.push({ sources: ["README.md: Architecture", "program/README.md: Kamino adapter"], content: [
  ...base(4, "One transaction. Two sources of truth."),
  textBox(20, "Architecture lead", 72, 214, 390, 88, "Brace reads the live obligation, validates the policy, then calls Kamino through CPI.", { size: 22, color: C.ink, bold: true }),
  // connectors first
  line(31, "Owner to app", 260, 412, 420, 412, C.blue, 2, true),
  line(32, "App to Kamino", 550, 412, 710, 412, C.blue, 2, true),
  line(33, "Watcher to guard", 420, 560, 710, 560, C.cyan, 2, true),
  line(34, "Guard to Kamino", 840, 490, 1010, 490, C.cyan, 2, true),
  rect(40, "Owner node", 72, 360, 188, 104, C.bg2, { round: true, line: { color: C.line, width: 1 } }),
  textBox(41, "Owner label", 92, 382, 145, 26, "OWNER + PHANTOM", { size: 13, color: C.cyan, bold: true }),
  textBox(42, "Owner copy", 92, 414, 145, 30, "Signs the boundary.", { size: 18, color: C.ink, bold: true }),
  rect(43, "App node", 420, 360, 130, 104, C.bg2, { round: true, line: { color: C.line, width: 1 } }),
  textBox(44, "App label", 440, 382, 92, 26, "NEXT.JS APP", { size: 12, color: C.cyan, bold: true }),
  textBox(45, "App copy", 440, 414, 92, 30, "Chat + reads", { size: 16, color: C.ink, bold: true }),
  rect(46, "Kamino node", 710, 360, 180, 104, C.bg2, { round: true, line: { color: C.line, width: 1 } }),
  textBox(47, "Kamino label", 730, 382, 140, 26, "KAMINO KLEND", { size: 13, color: C.cyan, bold: true }),
  textBox(48, "Kamino copy", 730, 414, 140, 30, "Obligation + reserves", { size: 16, color: C.ink, bold: true }),
  rect(49, "Guard node", 710, 520, 180, 104, C.blue2, { round: true, line: { color: C.blue, width: 1 } }),
  textBox(50, "Guard label", 730, 542, 140, 26, "BRACE GUARD", { size: 13, color: C.ink, bold: true }),
  textBox(51, "Guard copy", 730, 574, 140, 30, "Policy + CPI", { size: 16, color: C.ink, bold: true }),
  textBox(52, "Watcher", 420, 522, 230, 70, "WATCHER / AGENT KEY\nSubmits execute_action", { size: 16, color: C.muted, bold: true }),
]});

slides.push({ sources: ["README.md: Security model", "program/README.md: external programs and invariants"], content: [
  ...base(5, "The rule lives on-chain, not in an operator’s promise."),
  textBox(20, "Lead", 72, 214, 1060, 54, "The agent is useful because its authority is deliberately smaller than the owner’s.", { size: 24, color: C.ink, bold: true }),
  rect(30, "Safety line", 72, 310, 1136, 1, C.line),
  textBox(31, "Safety 1", 72, 342, 240, 30, "01  FIXED DESTINATION", { size: 13, color: C.cyan, bold: true }),
  textBox(32, "Safety 1 body", 72, 380, 240, 120, "No arbitrary recipient. Funds move to the configured Kamino supply vault.", { size: 19, color: C.ink, bold: true }),
  textBox(33, "Safety 2", 360, 342, 240, 30, "02  LIVE CHECKS", { size: 13, color: C.cyan, bold: true }),
  textBox(34, "Safety 2 body", 360, 380, 240, 120, "Account owners, market relationships, oracle status, and freshness are checked at execution.", { size: 19, color: C.ink, bold: true }),
  textBox(35, "Safety 3", 648, 342, 240, 30, "03  HARD LIMITS", { size: 13, color: C.cyan, bold: true }),
  textBox(36, "Safety 3 body", 648, 380, 240, 120, "Cap, cooldown, action window, expiry, and trigger are enforced by the program.", { size: 19, color: C.ink, bold: true }),
  textBox(37, "Safety 4", 936, 342, 240, 30, "04  OWNER EXIT", { size: 13, color: C.cyan, bold: true }),
  textBox(38, "Safety 4 body", 936, 380, 240, 120, "Pause, revoke, and withdraw remain owner-controlled.", { size: 19, color: C.ink, bold: true }),
  line(40, "Bottom accent", 72, 574, 1208, 574, C.blue, 3),
  textBox(41, "Bottom note", 72, 594, 1000, 40, "The watcher proposes execution. The chain decides whether it is allowed.", { size: 18, color: C.muted, bold: true }),
]});

slides.push({ sources: ["README.md: What is implemented", "frontend/README.md: architecture and wallet/data source"], content: [
  ...base(6, "Built to be inspected before it is trusted."),
  textBox(20, "Metric 1", 72, 242, 240, 82, "08", { size: 48, color: C.blue, bold: true }),
  textBox(21, "Metric 1 label", 72, 324, 240, 44, "on-chain instructions", { size: 18, color: C.ink, bold: true }),
  textBox(22, "Metric 2", 362, 242, 240, 82, "90", { size: 48, color: C.blue, bold: true }),
  textBox(23, "Metric 2 label", 362, 324, 240, 44, "day delegation ceiling", { size: 18, color: C.ink, bold: true }),
  textBox(24, "Metric 3", 652, 242, 240, 82, "314", { size: 48, color: C.blue, bold: true }),
  textBox(25, "Metric 3 label", 652, 324, 240, 44, "tests in the repository", { size: 18, color: C.ink, bold: true }),
  textBox(26, "Metric 4", 940, 242, 240, 82, "0", { size: 48, color: C.green, bold: true }),
  textBox(27, "Metric 4 label", 940, 324, 240, 44, "arbitrary destinations", { size: 18, color: C.ink, bold: true }),
  rect(30, "Build rail", 72, 432, 1136, 1, C.line),
  textBox(31, "Build title", 72, 464, 280, 28, "THE IMPLEMENTATION IS TRACEABLE", { size: 13, color: C.cyan, bold: true }),
  textBox(32, "Build body", 72, 504, 1020, 72, "Direct KLend account decoding. Pinned program IDs. Shared LTV vectors across Rust and TypeScript. Negative cases covered in the test suite.", { size: 20, color: C.ink, bold: true }),
]});

slides.push({ sources: ["README.md: Web application", "frontend/components/analytics/crypto-analytics.tsx"], content: [
  ...base(7, "The product is a chat, because policy is a conversation."),
  textBox(20, "Chat prompt", 72, 230, 566, 102, "“At 80% LTV, repay toward 70%.”", { size: 30, color: C.ink, bold: true, fill: C.bg2, alpha: 100000, margin: 22 }),
  textBox(21, "Chat detail", 72, 354, 566, 82, "The interface keeps the user in natural language while the command path stays deterministic.", { size: 20, color: C.muted }),
  rect(30, "Feature rail", 720, 230, 4, 310, C.blue),
  textBox(31, "Feature 1", 758, 230, 380, 40, "POSITION READOUTS", { size: 13, color: C.cyan, bold: true }),
  textBox(32, "Feature 1 body", 758, 270, 380, 56, "LTV, liquidation distance, reserve, and liveness.", { size: 20, color: C.ink, bold: true }),
  textBox(33, "Feature 2", 758, 354, 380, 40, "ANALYTICS", { size: 13, color: C.cyan, bold: true }),
  textBox(34, "Feature 2 body", 758, 394, 380, 56, "Market pulse, reference assets, and risk context.", { size: 20, color: C.ink, bold: true }),
  textBox(35, "Feature 3", 758, 478, 380, 40, "DEMO + DEVNET", { size: 13, color: C.cyan, bold: true }),
  textBox(36, "Feature 3 body", 758, 518, 380, 56, "Explore without a wallet. Connect when you’re ready to sign.", { size: 20, color: C.ink, bold: true }),
]});

slides.push({ sources: ["README.md: Devnet tooling", "tools/devnet/README.md"], content: [
  ...base(8, "The proof is already reproducible on devnet."),
  textBox(20, "Proof lead", 72, 222, 470, 90, "This is not a mock-only story. The repository ships the path to a real KLend test position.", { size: 24, color: C.ink, bold: true }),
  textBox(21, "Proof body", 72, 340, 470, 120, "Create the market. Refresh live Pyth feeds. Open a borrow. Read the obligation. Let the watcher submit the action.", { size: 20, color: C.muted }),
  rect(30, "Proof 1", 660, 234, 416, 68, C.bg2, { round: true, line: { color: C.line, width: 1 } }),
  textBox(31, "Proof 1 text", 686, 254, 360, 28, "01  LIVE PYTH FEEDS", { size: 16, color: C.cyan, bold: true }),
  rect(32, "Proof 2", 660, 332, 416, 68, C.bg2, { round: true, line: { color: C.line, width: 1 } }),
  textBox(33, "Proof 2 text", 686, 352, 360, 28, "02  REAL KLEND OBLIGATION", { size: 16, color: C.cyan, bold: true }),
  rect(34, "Proof 3", 660, 430, 416, 68, C.bg2, { round: true, line: { color: C.line, width: 1 } }),
  textBox(35, "Proof 3 text", 686, 450, 360, 28, "03  REPRODUCIBLE TOOLING", { size: 16, color: C.cyan, bold: true }),
  rect(36, "Proof 4", 660, 528, 416, 68, C.blue2, { round: true, line: { color: C.blue, width: 1 } }),
  textBox(37, "Proof 4 text", 686, 548, 360, 28, "04  OWNER-SIGNED FLOW", { size: 16, color: C.ink, bold: true }),
]});

slides.push({ sources: ["README.md: Scope", "README.md: Roadmap", "README.md: Security model"], content: [
  ...base(9, "The first release is focused — and that makes the next proof clear."),
  textBox(20, "Focus", 72, 224, 340, 32, "WHAT V1 ALREADY DOES", { size: 13, color: C.cyan, bold: true }),
  textBox(21, "Focus body", 72, 270, 420, 146, "• Guards one Kamino obligation per guard\n• Repays debt when the trigger is reached\n• Keeps the owner in control of funds and exit", { size: 21, color: C.ink, bold: true }),
  line(30, "Roadmap line", 622, 244, 622, 542, C.line, 2),
  textBox(31, "Next", 702, 224, 340, 32, "WHAT COMES NEXT", { size: 13, color: C.cyan, bold: true }),
  textBox(32, "Next body", 702, 270, 420, 146, "• Broaden collateral top-up support\n• Continue devnet verification\n• Complete independent security review before mainnet", { size: 21, color: C.ink, bold: true }),
  line(33, "Bottom accent", 72, 574, 1208, 574, C.blue, 3),
  textBox(34, "Closing note", 72, 596, 1000, 32, "A clear scope is not a smaller ambition. It is a sharper path to trust.", { size: 19, color: C.muted, bold: true }),
]});

slides.push({ sources: ["README.md: Problem and solution", "README.md: What is implemented"], content: [
  ...base(10, "Give liquidation defense a boundary."),
  textBox(20, "Close lead", 72, 230, 610, 110, "Brace lets a user define exactly what automation may do before the market moves.", { size: 32, color: C.ink, bold: true }),
  textBox(21, "Close body", 72, 380, 520, 80, "Connect a wallet. Open a devnet position. Set the rule. Keep the authority narrow.", { size: 21, color: C.muted }),
  line(22, "Close accent", 72, 520, 302, 520, C.blue, 4),
  textBox(23, "CTA", 72, 548, 520, 36, "BRACE  /  POLICY-CONSTRAINED LIQUIDATION DEFENSE", { size: 13, color: C.cyan, bold: true }),
  rect(30, "Closing panel", 780, 238, 360, 260, C.bg2, { round: true, line: { color: C.line, width: 1 } }),
  textBox(31, "Closing panel title", 820, 278, 280, 34, "OWNER CONTROL", { size: 14, color: C.cyan, bold: true }),
  textBox(32, "Closing panel body", 820, 332, 280, 110, "Your rule.\nYour reserve.\nYour exit.", { size: 29, color: C.ink, bold: true }),
]});

function contentTypes() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/><Override PartName="/ppt/notesMasters/_rels/notesMaster1.xml.rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/notesSlides/notesSlide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`).join("")}</Types>`;
}
function rootRels() { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`; }
function presentationXml() { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join("")}</p:sldIdLst><p:sldSz cx="${emu(W)}" cy="${emu(H)}" type="screen16x9"/><p:notesSz cx="${emu(720)}" cy="${emu(540)}"/><p:defaultTextStyle><a:defPPr/><a:lvl1pPr marL="0" algn="l"><a:defRPr sz="1800"/></a:lvl1pPr></p:defaultTextStyle></p:presentation>`; }
function presentationRels() { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>${slides.map((_, i) => `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join("")}</Relationships>`; }
function themeXml() { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Brace"><a:themeElements><a:clrScheme name="Brace"><a:dk1><a:srgbClr val="07111F"/></a:dk1><a:lt1><a:srgbClr val="F6FAFF"/></a:lt1><a:dk2><a:srgbClr val="07111F"/></a:dk2><a:lt2><a:srgbClr val="F6FAFF"/></a:lt2><a:accent1><a:srgbClr val="3C9DFF"/></a:accent1><a:accent2><a:srgbClr val="7AD7FF"/></a:accent2><a:accent3><a:srgbClr val="64E2B0"/></a:accent3><a:accent4><a:srgbClr val="1468D8"/></a:accent4><a:accent5><a:srgbClr val="A8B5C8"/></a:accent5><a:accent6><a:srgbClr val="1C334D"/></a:accent6><a:hlink><a:srgbClr val="3C9DFF"/></a:hlink><a:folHlink><a:srgbClr val="7AD7FF"/></a:folHlink></a:clrScheme><a:fontScheme name="Brace"><a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:fontScheme><a:fmtScheme name="Brace"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme></a:themeElements></a:theme>`; }
function masterXml() { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld name="Brace master"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="dk1" bg2="dk2" folHlink="folHlink" hlink="hlink" tx1="lt1" tx2="lt2" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"/><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`; }
function layoutXml() { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`; }
function notesMasterXml() { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:notesMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:hf/><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="dk1" bg2="dk2" folHlink="folHlink" hlink="hlink" tx1="lt1" tx2="lt2" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"/><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:notesMaster>`; }
function notesMasterRels() { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`; }
function coreXml() { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"><dc:title>Brace — Policy-constrained liquidation defense</dc:title><dc:subject>Product pitch deck</dc:subject><dc:creator>Brace</dc:creator><cp:lastModifiedBy>Brace</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">2026-09-06T00:00:00Z</dcterms:created></cp:coreProperties>`; }
function appXml() { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Brace presentation builder</Application><PresentationFormat>Widescreen</PresentationFormat><Slides>${slides.length}</Slides></Properties>`; }

ensureDir(root);
write(path.join(root, "[Content_Types].xml"), contentTypes());
write(path.join(root, "_rels/.rels"), rootRels());
write(path.join(root, "ppt/presentation.xml"), presentationXml());
write(path.join(root, "ppt/_rels/presentation.xml.rels"), presentationRels());
write(path.join(root, "ppt/theme/theme1.xml"), themeXml());
write(path.join(root, "ppt/slideMasters/slideMaster1.xml"), masterXml());
write(path.join(root, "ppt/slideMasters/_rels/slideMaster1.xml.rels"), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`);
write(path.join(root, "ppt/slideLayouts/slideLayout1.xml"), layoutXml());
write(path.join(root, "ppt/slideLayouts/_rels/slideLayout1.xml.rels"), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`);
write(path.join(root, "ppt/notesMasters/notesMaster1.xml"), notesMasterXml());
write(path.join(root, "ppt/notesMasters/_rels/notesMaster1.xml.rels"), notesMasterRels());
write(path.join(root, "docProps/core.xml"), coreXml());
write(path.join(root, "docProps/app.xml"), appXml());
ensureDir(path.join(root, "ppt/media"));
fs.copyFileSync(asset, path.join(root, "ppt/media/brace-banner.png"));
slides.forEach((slide, index) => {
  const n = index + 1;
  write(path.join(root, `ppt/slides/slide${n}.xml`), slideXml(n, slide.content.join(""), !!slide.image));
  write(path.join(root, `ppt/slides/_rels/slide${n}.xml.rels`), slideRels(!!slide.image));
  write(path.join(root, `ppt/notesSlides/notesSlide${n}.xml`), notesXml(n, slide.sources));
  write(path.join(root, `ppt/notesSlides/_rels/notesSlide${n}.xml.rels`), notesRels(n));
});
try { fs.unlinkSync(output); } catch {}
execFileSync("zip", ["-qr", output, "."], { cwd: root });
console.log(output);
