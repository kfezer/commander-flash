// Pure parsing helpers for Simplicity Commander output and firmware files.
// No vscode imports here, so these run under plain `node --test`.

export interface Board {
  serial: string;
  boardId: string;
  description: string;
}

const MAINBOARDS = new Set(["4001A", "4002A"]);

/** Parse `commander adapter list --json`. */
export function parseAdapterList(json: string): Board[] {
  const start = json.indexOf("{");
  if (start < 0) {
    return [];
  }
  const data = JSON.parse(json.slice(start));
  const devices: any[] = data?.result?.devices ?? [];
  return devices.map((d) => {
    // Kits with a separate mainboard (WSTK BRD4001A, WPK BRD4002A) list it alongside the
    // radio board. The radio board is the one the firmware is for.
    const boards: any[] = Array.isArray(d.boards) ? d.boards : [];
    const board = boards.find((b) => !MAINBOARDS.has(String(b.board_id).toUpperCase())) ?? boards[0] ?? {};
    return {
      serial: String(d.serial_number),
      boardId: String(board.board_id ?? d.adapter_id ?? "").toUpperCase(),
      description: String(board.board_description ?? d.adapter_description ?? "Unknown board"),
    };
  });
}

/** Parse the hex dump lines of `commander readmem` ("08000000: 08 10 00 20 ..."). */
export function parseReadmem(text: string): number[] {
  const bytes: number[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*[0-9A-Fa-f]{8}:\s+((?:[0-9A-Fa-f]{2}\s*)+)$/.exec(line);
    if (m) {
      for (const b of m[1].trim().split(/\s+/)) {
        bytes.push(parseInt(b, 16));
      }
    }
  }
  return bytes;
}

/** True when every byte read is 0xFF (erased flash). Empty input is not "erased". */
export function isErased(bytes: number[]): boolean {
  return bytes.length > 0 && bytes.every((b) => b === 0xff);
}

/**
 * Does this Intel HEX or S-record image write the first byte of flash (0x08000000)?
 * If so, the image brings its own bootloader (or is a bootloader / bare-metal image).
 */
export function imageCoversFlashBase(text: string, ext: string, base = 0x08000000): boolean {
  const e = ext.toLowerCase().replace(/^\./, "");
  if (e === "hex") {
    let upper = 0;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line.startsWith(":") || line.length < 11) {
        continue;
      }
      const len = parseInt(line.slice(1, 3), 16);
      const addr = parseInt(line.slice(3, 7), 16);
      const type = parseInt(line.slice(7, 9), 16);
      if (type === 0x04) {
        upper = parseInt(line.slice(9, 13), 16) << 16;
      } else if (type === 0x02) {
        upper = parseInt(line.slice(9, 13), 16) << 4;
      } else if (type === 0x00 && len > 0) {
        const start = (upper + addr) >>> 0;
        if (start <= base && base < start + len) {
          return true;
        }
      }
    }
    return false;
  }
  if (e === "s37" || e === "srec" || e === "mot") {
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      const kind = line.slice(0, 2);
      const addrChars = kind === "S1" ? 4 : kind === "S2" ? 6 : kind === "S3" ? 8 : 0;
      if (!addrChars) {
        continue;
      }
      const count = parseInt(line.slice(2, 4), 16);
      const addr = parseInt(line.slice(4, 4 + addrChars), 16);
      const dataLen = count - addrChars / 2 - 1;
      if (dataLen > 0 && addr <= base && base < addr + dataLen) {
        return true;
      }
    }
    return false;
  }
  return false;
}

/** Board ID named in a filename, e.g. "zigbee_light_brd2601b.hex" -> "2601B". */
export function boardHintFromFilename(name: string): string | undefined {
  const m = /brd(\d{4}[a-z])/i.exec(name);
  return m ? m[1].toUpperCase() : undefined;
}

/**
 * Where flash starts, from the part number Commander reports.
 * Series 2 from xG23 on (EFR32xG23+, EFM32PG23+, xGM23x+ modules): 0x08000000.
 * Series 0/1 and xG21/xG22: 0x00000000. Anything else (e.g. SiWx91x): undefined.
 */
export function flashBaseForPart(part: string): number | undefined {
  const p = part.toUpperCase();
  const m = /^(?:EFR32|EFM32)[A-Z]{2}(\d)(\d?)/.exec(p) ?? /^(?:BGM|MGM|FGM|ZGM)(\d)(\d)/.exec(p);
  if (m) {
    const series = Number(m[1]);
    const gen = Number(m[2]);
    return series === 2 && gen >= 3 ? 0x08000000 : 0x00000000;
  }
  // Series 0 EFM32 parts: EFM32G, EFM32GG, EFM32LG, EFM32WG, EFM32TG, EFM32ZG, EFM32HG.
  if (/^EFM32(?:G|GG|LG|WG|TG|ZG|HG)\d/.test(p)) {
    return 0x00000000;
  }
  return undefined;
}

/** Parse `commander device info --json` → part number. */
export function parseDeviceInfo(json: string): string | undefined {
  const start = json.indexOf("{");
  if (start < 0) {
    return undefined;
  }
  try {
    return JSON.parse(json.slice(start))?.result?.device_info?.part_number;
  } catch {
    return undefined;
  }
}

/** Parse `slt where <pkg> --json` → install path. */
export function parseSltWhere(text: string): string | undefined {
  const start = text.indexOf("[");
  if (start < 0) {
    return undefined;
  }
  try {
    const arr = JSON.parse(text.slice(start));
    return Array.isArray(arr) && typeof arr[0] === "string" ? arr[0] : undefined;
  } catch {
    return undefined;
  }
}
