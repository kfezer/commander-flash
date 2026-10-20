import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  boardHintFromFilename,
  flashBaseForPart,
  parseDeviceInfo,
  parseSltWhere,
  imageCoversFlashBase,
  isErased,
  parseAdapterList,
  parseReadmem,
} from "../src/parse";

// Compiled to out/test/, fixtures stay in test/fixtures/.
const fixture = (name: string) => readFileSync(join(__dirname, "..", "..", "test", "fixtures", name), "utf8");

test("parseAdapterList reads real Commander JSON", () => {
  const boards = parseAdapterList(fixture("adapter-list.json"));
  assert.equal(boards.length, 2);
  const ids = boards.map((b) => b.boardId).sort();
  assert.deepEqual(ids, ["2601B", "2703A"]);
  const dev = boards.find((b) => b.boardId === "2601B")!;
  assert.equal(dev.serial, "440349857");
  assert.match(dev.description, /xG24/);
});

test("parseAdapterList tolerates text before the JSON and empty lists", () => {
  assert.deepEqual(parseAdapterList('noise\n{"result":{"devices":[]}}'), []);
  assert.deepEqual(parseAdapterList(""), []);
});

test("parseReadmem + isErased: bootloader present", () => {
  const bytes = parseReadmem(fixture("readmem-present.txt"));
  assert.equal(bytes.length, 16);
  assert.equal(bytes[0], 0x08);
  assert.equal(isErased(bytes), false);
});

test("parseReadmem + isErased: erased region", () => {
  const text = "Reading 16 bytes from 0x08000000...\n{address:  0  1  2  3}\n08000000: " + "FF ".repeat(16) + "\n\nDONE\n";
  const bytes = parseReadmem(text);
  assert.equal(bytes.length, 16);
  assert.equal(isErased(bytes), true);
  assert.equal(isErased([]), false);
});

test("imageCoversFlashBase: Intel HEX", () => {
  const withBase = ":020000040800F2\n:10000000081000205F2700086327000873220008FB\n:00000001FF\n";
  const appOnly = ":020000040800F2\n:106000000810002000000000000000000000000068\n:00000001FF\n";
  assert.equal(imageCoversFlashBase(withBase, ".hex"), true);
  assert.equal(imageCoversFlashBase(appOnly, ".hex"), false);
});

test("imageCoversFlashBase: S37", () => {
  const bootloader = fixture("../../bootloaders/xg24-internal-single-1536k.s37");
  assert.equal(imageCoversFlashBase(bootloader, "s37"), true);
  const appOnly = "S31508006000081000206FC4000829B102086DC40008F2\nS70508006000\n";
  assert.equal(imageCoversFlashBase(appOnly, "S37"), false);
});

test("boardHintFromFilename", () => {
  assert.equal(boardHintFromFilename("zigbee_light_brd2601b.hex"), "2601B");
  assert.equal(boardHintFromFilename("SWITCH_BRD2703A.s37"), "2703A");
  assert.equal(boardHintFromFilename("firmware.hex"), undefined);
});

test("bundled bootloaders start with an S0 header (Commander rejects them otherwise)", () => {
  const text = fixture("../../bootloaders/xg24-internal-single-1536k.s37");
  assert.match(text.split(/\r?\n/)[0], /^S0/);
});

test("parseAdapterList prefers the radio board over a WSTK/WPK mainboard", () => {
  const json = JSON.stringify({ result: { devices: [{ serial_number: 1, adapter_id: "4002A", boards: [
    { board_id: "4002A", board_description: "Wireless Pro Kit Mainboard" },
    { board_id: "4186C", board_description: "EFR32xG24 Radio Board" },
  ] }] } });
  const [b] = parseAdapterList(json);
  assert.equal(b.boardId, "4186C");
  assert.match(b.description, /Radio Board/);
});

test("flashBaseForPart", () => {
  assert.equal(flashBaseForPart("EFR32MG24B310F1536IM48"), 0x08000000);
  assert.equal(flashBaseForPart("EFR32ZG23B020F512IM48"), 0x08000000);
  assert.equal(flashBaseForPart("EFM32PG28B310F1024IM68"), 0x08000000);
  assert.equal(flashBaseForPart("MGM240PB32VNA"), 0x08000000);
  assert.equal(flashBaseForPart("EFR32MG21A010F1024IM32"), 0x00000000);
  assert.equal(flashBaseForPart("EFR32BG22C224F512IM40"), 0x00000000);
  assert.equal(flashBaseForPart("BGM220PC22HNA"), 0x00000000);
  assert.equal(flashBaseForPart("EFR32MG12P332F1024GL125"), 0x00000000);
  assert.equal(flashBaseForPart("EFM32GG990F1024"), 0x00000000);
  assert.equal(flashBaseForPart("EFR32MG1P232F256GM48"), 0x00000000);
  assert.equal(flashBaseForPart("EFM32G890F128"), 0x00000000);
  assert.equal(flashBaseForPart("SIWG917M111MGTBA"), undefined);
});

test("parseDeviceInfo and parseSltWhere", () => {
  assert.equal(parseDeviceInfo('{"result":{"device_info":{"part_number":"EFR32MG24B310F1536IM48"}},"success":true}'), "EFR32MG24B310F1536IM48");
  assert.equal(parseDeviceInfo("garbage"), undefined);
  assert.equal(parseSltWhere('[\n "/home/u/.silabs/slt/installs/archive/Commander.app"\n]'), "/home/u/.silabs/slt/installs/archive/Commander.app");
  assert.equal(parseSltWhere("not installed"), undefined);
});
