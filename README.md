# Commander Flash (unofficial)

Flash firmware, open a serial console, and manage the bootloader on Silicon
Labs boards, all from VS Code. Under the hood it runs **Simplicity
Commander**, Silicon Labs' command-line programming tool. You don't need
a Simplicity Studio project or Simplicity Studio itself: open any folder
(cloned from GitHub, GitLab, or anywhere) that has a `.hex` or `.s37` file
and flash it.

> Community tool. Not made or supported by Silicon Labs. "Simplicity
> Commander" is Silicon Labs' product; this extension only calls it.

## What it does

A **Commander Flash** icon in the Activity Bar opens a **Boards** list of
every connected board, with its name and J-Link serial number. Right-click
a board (or use the inline buttons):

| Action | What happens |
|---|---|
| **Flash…** | Choose a `.hex` / `.s37` from the open folder (or browse), and flash it to that board |
| **Open Console** | Opens the board's serial console in a VS Code terminal (`commander vcom connect`). Type straight into it; close the terminal to disconnect |
| **Check Bootloader** | Reads the first bytes of flash. All `FF` means there's no bootloader |
| **Install Bootloader** | Flashes a bootloader for that board (bundled for the boards below, or your own) |
| **Erase Board…** | Mass-erases the chip, bootloader included, after you confirm |

You can also right-click a `.hex` or `.s37` file in the Explorer and choose
**Flash to Board…**. With only one board plugged in, it's picked
automatically.

### Safety checks before flashing

- **Wrong board:** if the filename names a board (for example
  `..._brd2601b.hex`) and you picked a different one, you're asked to
  confirm first.
- **Missing bootloader:** if the file doesn't write the start of flash
  (`0x08000000`), meaning it's an app that expects a bootloader, and the
  board has none, you're offered **Install bootloader, then flash**.

## Install

1. Install **Simplicity Commander**. It comes with Simplicity Studio 6 and
   the Silicon Labs installer, or you can
   [download it on its own](https://www.silabs.com/developer-tools/simplicity-studio/simplicity-commander).
2. In VS Code, open the Command Palette and run **Extensions: Install from
   VSIX…**, then choose `commander-flash-0.1.0.vsix`.
3. Click the **Commander Flash** (⚡) icon in the Activity Bar.

If the Boards view says Commander wasn't found, click **Set Commander
path** and choose the `commander` executable.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `commanderFlash.path` | *(empty)* | Full path to `commander`. Empty = search PATH, then the usual install locations |
| `commanderFlash.autoRefreshSeconds` | `5` | How often the board list refreshes. `0` = only when you click Refresh |
| `commanderFlash.bootloaders` | `{}` | Bootloader per board ID, e.g. `{ "2601B": "/path/to/bootloader.s37" }`. Adds to or overrides the bundled ones |

Where it looks for Commander when `commanderFlash.path` is empty:

| OS | Locations | Tested |
|---|---|---|
| macOS | `~/.silabs/slt/installs/archive/Commander.app/Contents/MacOS/commander`, `/Applications/Commander.app/…` | First one, yes |
| Windows | `commander.exe` on PATH, `~\.silabs\slt\…`, `%LOCALAPPDATA%\SiliconLabs\…`, `C:\SiliconLabs\SimplicityStudio\v5\…` | No |
| Linux | `commander` on PATH, `~/.silabs/slt/installs/archive/commander/…`, `/opt/commander/` | No |

If yours isn't found, set `commanderFlash.path`.

## Bundled bootloaders

| Board ID | Board | Image |
|---|---|---|
| `2601B` | EFR32xG24 Dev Kit (BRD2601B, micro-USB) | Gecko bootloader "SoC Internal Storage (single image on 1536kB device)" |
| `2703A` | xG24 Explorer Kit (BRD2703A, USB-C) | Same image (same EFR32MG24 part) |

For other boards, create the bootloader example for your part, build it,
and either pick the file when asked or add it to `commanderFlash.bootloaders`.

## Troubleshooting

- **Every action and its full Commander output** is logged in the
  **Commander** output channel (View → Output → Commander).
- **Board missing from the list:** use a USB *data* cable, then click
  Refresh. `commander adapter list` in a terminal should show it too.
- **App flashed, but no serial output and no LEDs:** the board probably has
  no bootloader. Run **Check Bootloader**.
- **Console shows nothing:** press Enter; many firmwares only print a
  prompt after input. Close any other serial terminal using the same port.

## Develop

```bash
npm install
npm test          # compile + unit tests (node --test)
npm run package   # builds commander-flash-<version>.vsix
```

Press F5 in VS Code (with this folder open) to run it in an Extension
Development Host.

## License

MIT
