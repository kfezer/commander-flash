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

The board list appears in two places: behind the **⚡ Commander Flash**
icon in the Activity Bar, and as a **Silicon Labs Boards** panel in the
**Explorer**, under your files. It shows every connected board with its
name and J-Link serial number. Each board row has three buttons:

| Button | Action | What happens |
|---|---|---|
| ⚡ | **Flash…** | Choose a `.hex` / `.s37` from the open folder (or browse), and flash it to that board |
| 🐞 | **Debug…** | Builds the project, then starts a debug session on that board (breakpoints, stepping, variables), stopping at `main` |
| ⌨ | **Open Console** | Opens the board's serial console in a VS Code terminal (`commander vcom connect`). Type straight into it; close the terminal to disconnect |

The panel's title bar has **🔧 Build Project** and **Refresh**. Right-click
a board for more:

| Action | What happens |
|---|---|
| **Check Bootloader** | Reads the first bytes of flash. All `FF` means there's no bootloader |
| **Install Bootloader** | Flashes a bootloader for that board (bundled for the boards below, or your own) |
| **Erase Board…** | Mass-erases the chip, bootloader included, after you confirm |

You can also right-click a `.hex` or `.s37` file in the Explorer and choose
**Flash to Board…**. With only one board plugged in, it's picked
automatically.

### Build and Debug

These work on Silicon Labs projects generated for the **VS Code** or
**CMake** target, meaning any folder with a `cmake_gcc/CMakePresets.json`.

- **Build** runs `cmake --workflow --preset project` as a VS Code task, so
  compiler errors show up in the **Problems** panel. The outputs (`.out`,
  `.s37`, `.hex`) go to `cmake_gcc/build/<configuration>/` and appear in
  the Flash file list.
- **Debug** builds first, then launches
  [Cortex-Debug](https://marketplace.visualstudio.com/items?itemName=marus25.cortex-debug)
  with SEGGER's J-Link GDB server on the board you picked. If Cortex-Debug
  isn't installed, you're offered the install. If the board has no
  bootloader and the app needs one, you're offered to install it first.

Build and Debug use the tools Silicon Labs' installer (`slt`) manages:
`cmake`, `ninja`, `gcc-arm-none-eabi` (which includes `gdb`) and `exx32`
(the J-Link GDB server). These are already there if you have Simplicity
Studio 6. Otherwise, run `slt install cmake ninja gcc-arm-none-eabi exx32`.

### Safety checks before flashing

- **Wrong board:** if the filename names a board (for example
  `..._brd2601b.hex`) and you picked a different one, you're asked to
  confirm first.
- **Missing bootloader:** if the file doesn't write the start of flash
  (`0x08000000`), meaning it's an app that expects a bootloader, and the
  board has none, you're offered **Install bootloader, then flash**.

## Install

1. Download `commander-flash-<version>.vsix` from this repo's
   [Releases](https://github.com/kfezer/commander-flash/releases).
2. In VS Code, open the Command Palette and run **Extensions: Install from
   VSIX…**, then choose that file.
3. Click the **⚡ Commander Flash** icon in the Activity Bar, or open the
   **Explorer**, where the **Silicon Labs Boards** panel is under your files.

### Don't have Simplicity Commander?

The extension finds Commander if Simplicity Studio, the Simplicity
Installer, or a standalone Commander already put it on your computer. If it
can't find it, the Silicon Labs Boards panel offers **Install Commander**, which:

1. uses Silicon Labs' own installer CLI, `slt`. If `slt` isn't already on
   your computer, it's downloaded from silabs.com (about 13 MB).
2. runs `slt install commander`, which puts Commander (about 70 MB) in
   `~/.silabs/slt/installs/archive/`, the same place Simplicity Studio puts it.
3. saves the path in `commanderFlash.path`.

Commander is Silicon Labs software, under their license terms. If you
installed it somewhere else, click **Set Commander path** instead.

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

## Which boards work

| Feature | Works with |
|---|---|
| Board list, Flash, Open Console, Erase, Debug | Any board Simplicity Commander can talk to over its J-Link debugger: Silicon Labs Dev Kits, Explorer Kits, Pro Kits, and radio boards on a WSTK/WPK mainboard |
| Check Bootloader, bootloader guard | EFR32/EFM32 Series 0, 1 and 2 and the xGM modules. The extension reads the chip's part number to find where flash starts (`0x08000000` on xG23 and newer, `0x00000000` on older parts). Not supported on SiWx91x |
| Install Bootloader (bundled) | The EFR32xG24 Dev Kit (BRD2601B) and xG24 Explorer Kit (BRD2703A). For other boards, supply your own bootloader file |
| Friendly board names | BRD2601B and BRD2703A. Other boards show Commander's own description |

Tested on hardware: BRD2601B and BRD2703A on macOS. Build was tested with a clean build of a generated Zigbee project. Debug was tested by running the same J-Link GDB server and gdb that the Debug button uses (connect, halt, backtrace into `main`); the Cortex-Debug session itself hasn't been tested here. Other boards and
operating systems should work but haven't been tried.

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

## Releasing

Pushes to `main` run the tests (**CI** workflow). Publishing is automatic
from a version tag (**Release** workflow):

```bash
npm version patch          # or minor / major: bumps package.json, commits, tags vX.Y.Z
git push --follow-tags
```

The Release workflow checks that the tag matches `package.json`, runs the
tests, publishes to the VS Code Marketplace, and creates a GitHub release
with the `.vsix` attached. It needs the repository secret `VSCE_PAT`.

## License

MIT
