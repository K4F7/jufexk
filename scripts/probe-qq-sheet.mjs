import { inflateSync } from "node:zlib";

const sheetUrl =
  process.argv.slice(2).find((argument) => !argument.startsWith("--")) ||
  "https://docs.qq.com/sheet/DUFVCWkdsRU5BdEhH?right_flag=1";
const debugPath = process.argv.find((argument) =>
  argument.startsWith("--path="),
)?.slice(7);
const treePath = process.argv.find((argument) =>
  argument.startsWith("--tree="),
)?.slice(7);
const take = Number(
  process.argv.find((argument) => argument.startsWith("--take="))?.slice(7) ||
    0,
);
const tab = process.argv.find((argument) => argument.startsWith("--tab="))?.slice(6);
const cellsMode = process.argv.includes("--cells");
const legacyMode = process.argv.includes("--legacy");
const metaMode = process.argv.includes("--meta");
const headers = { "User-Agent": "Mozilla/5.0 (compatible; jufexk-import/1.0)" };

const page = await fetch(sheetUrl, { headers });
if (!page.ok) throw new Error(`sheet page returned ${page.status}`);
const html = await page.text();
const match = html.match(
  /<script[^>]+src="([^"]*\/dop-api\/opendoc[^"]+)"/i,
);
if (!match) throw new Error("opendoc endpoint was not found");
const endpoint = new URL(match[1].replaceAll("&amp;", "&"), sheetUrl);
if (tab) endpoint.searchParams.set("tab", tab);
if (legacyMode) {
  for (const key of [
    "enableSmartsheetSplit",
    "sliceStates",
    "block_end_col",
    "block_end_row",
    "block_start_col",
    "block_start_row",
    "wb",
    "nowb",
  ])
    endpoint.searchParams.delete(key);
}
const response = await fetch(endpoint, {
  headers: { ...headers, Referer: sheetUrl },
});
if (!response.ok) throw new Error(`opendoc returned ${response.status}`);
const jsonp = await response.text();
const payload = JSON.parse(
  jsonp.slice(jsonp.indexOf("(") + 1, jsonp.lastIndexOf(")")),
);
const initial =
  payload.clientVars.collab_client_vars.initialAttributedText.text[0];
if (metaMode) {
  console.log(
    JSON.stringify(
      {
        endpoint: String(endpoint),
        initial,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
const compressed = Buffer.from(
  initial.block_datas[0].related_sheet,
  "base64",
);
const protobuf = inflateSync(compressed);

function readVarint(buffer, offset) {
  let value = 0n;
  let shift = 0n;
  while (offset < buffer.length) {
    const byte = buffer[offset++];
    value |= BigInt(byte & 0x7f) << shift;
    if (byte < 0x80) return [value, offset];
    shift += 7n;
    if (shift > 63n) throw new Error("varint overflow");
  }
  throw new Error("truncated varint");
}

function printableUtf8(buffer) {
  const value = buffer.toString("utf8");
  if (!value || value.includes("\uFFFD")) return null;
  const printable = [...value].filter(
    (character) => !/\p{Cc}/u.test(character) || /[\t\r\n]/.test(character),
  ).length;
  return printable / [...value].length > 0.95 ? value : null;
}

function scan(buffer, path = "", depth = 0, output = []) {
  let offset = 0;
  while (offset < buffer.length) {
    let tag;
    try {
      [tag, offset] = readVarint(buffer, offset);
    } catch {
      return output;
    }
    const field = Number(tag >> 3n);
    const wire = Number(tag & 7n);
    if (!field || ![0, 1, 2, 5].includes(wire)) return output;
    const fieldPath = `${path}.${field}`;
    if (wire === 0) {
      let value;
      [value, offset] = readVarint(buffer, offset);
      output.push({ path: fieldPath, type: "varint", value: String(value) });
    } else if (wire === 1 || wire === 5) {
      const size = wire === 1 ? 8 : 4;
      if (offset + size > buffer.length) return output;
      offset += size;
    } else {
      let length;
      [length, offset] = readVarint(buffer, offset);
      const size = Number(length);
      if (offset + size > buffer.length) return output;
      const value = buffer.subarray(offset, offset + size);
      offset += size;
      const text = printableUtf8(value);
      if (text) output.push({ path: fieldPath, type: "string", value: text });
      else if (depth < 16) scan(value, fieldPath, depth + 1, output);
    }
  }
  return output;
}

function decodeMessage(buffer, depth = 0) {
  const fields = [];
  let offset = 0;
  try {
    while (offset < buffer.length) {
      let tag;
      [tag, offset] = readVarint(buffer, offset);
      const field = Number(tag >> 3n);
      const wire = Number(tag & 7n);
      if (!field || ![0, 1, 2, 5].includes(wire))
        return { valid: false, fields };
      if (wire === 0) {
        let value;
        [value, offset] = readVarint(buffer, offset);
        fields.push({ field, wire, value: String(value) });
      } else if (wire === 1 || wire === 5) {
        const size = wire === 1 ? 8 : 4;
        if (offset + size > buffer.length) return { valid: false, fields };
        fields.push({
          field,
          wire,
          value: buffer.subarray(offset, offset + size).toString("hex"),
        });
        offset += size;
      } else {
        let length;
        [length, offset] = readVarint(buffer, offset);
        const size = Number(length);
        if (offset + size > buffer.length) return { valid: false, fields };
        const value = buffer.subarray(offset, offset + size);
        offset += size;
        const text = printableUtf8(value);
        if (depth < 20) {
          const child = decodeMessage(value, depth + 1);
          fields.push(
            child.valid && child.fields.length
              ? { field, wire, message: child.fields }
              : text
                ? { field, wire, text }
                : { field, wire, bytes: value.toString("hex") },
          );
        } else if (text) fields.push({ field, wire, text });
      }
    }
  } catch {
    return { valid: false, fields };
  }
  return { valid: offset === buffer.length, fields };
}

function selectMessages(fields, numbers) {
  let current = [{ message: fields }];
  for (const number of numbers)
    current = current.flatMap((node) =>
      (node.message || []).filter(
        (field) => field.field === number && field.message,
      ),
    );
  return current;
}

function collectText(fields, output = []) {
  for (const field of fields || []) {
    if (field.text) output.push(field.text);
    if (field.message) collectText(field.message, output);
  }
  return output;
}

if (cellsMode) {
  const root = decodeMessage(protobuf);
  const content = selectMessages(root.fields, [1, 5, 19, 5])[0]?.message || [];
  const ignored = /^(?:[A-F0-9]{8}|Arial|等线|微软雅黑|Microsoft YaHei|PingFang SC)$/;
  const cells = content
    .filter((field) => field.field === 1 || field.field === 2)
    .map((field, index) => ({
      index,
      type: field.field === 1 ? "plain" : "rich",
      text: collectText(field.message)
        .filter((value) => !ignored.test(value))
        .filter((value, position, values) => values.indexOf(value) === position)
        .join(""),
    }));
  console.log(JSON.stringify(cells, null, 2));
  process.exit(0);
}

if (treePath) {
  const root = decodeMessage(protobuf);
  const numbers = treePath.split(".").filter(Boolean).map(Number);
  const selected = selectMessages(root.fields, numbers);
  console.log(JSON.stringify(take ? selected.slice(0, take) : selected, null, 2));
  process.exit(0);
}

const strings = scan(protobuf).filter(
  (item) =>
    item.type === "string" &&
    (item.value.length > 2 || /[^\x00-\x7f]/.test(item.value)),
);
if (debugPath) {
  console.log(
    JSON.stringify(
      scan(protobuf).filter((item) => item.path.startsWith(debugPath)),
      null,
      2,
    ),
  );
  process.exit(0);
}
console.log(
  JSON.stringify(
    {
      title: payload.clientVars.collab_client_vars.initialTitle,
      tab: initial.block_datas[0].sub_id,
      rows: initial.max_row,
      columns: initial.max_col,
      protobufBytes: protobuf.length,
      strings,
    },
    null,
    2,
  ),
);
