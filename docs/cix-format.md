# Biesse bSolid `.cix` — block reference & safety notes

This document describes the `.cix` structure emitted by `src/cix.ts` and how to
adapt it to your machine. Treat it as a living engineering note, not a
Biesse-official specification.

## What a CIX file is

A Biesse part program (`.cix`) is a plain-text, line-oriented file. Each line is
an **operation block**: an alphanumeric operation label followed by numeric
coordinate/parameter values. Numeric values carry an explicit **sign prefix**
(`+` / `-`). Coordinates are in millimetres.

## Block structure emitted

The compiler writes, per panel:

| Label | Meaning |
| --- | --- |
| `PAN` | Piece definition — the part identifier |
| `DIM` | Finished dimensions + thickness: `X Y T` |
| `FNC` | Function control — activate/deactivate a machining unit (`BOR` boring block, `AGG` horizontal aggregate, `ROUT` router) |
| `LPX` / `LPY` | Linear positioning on X / Y |
| `BOR` | Boring/drilling: `D` diameter, `P` depth, optional `EDGE` for horizontal boring |
| `RAI` | Routing/grooving move: `X Y W P` (target, tool width, depth) |
| `EPN` | End of panel |

`;`-prefixed lines are comments (part, cabinet, material, grain, date).

### Example

```text
; Biesse Rover A  -  bSolid native part program (.cix)
; PART  : BASE-01-001
; MAT   : 18mm Melamine White  T=18mm
PAN BASE-01-001
DIM X+560.00 Y+720.00 T+18.00
FNC BOR  ON
LPX +30.00
LPY +90.00
BOR D+5.00 P+5.00
FNC BOR  OFF
EPN
```

## ⚠️ Safety / accuracy caveats

1. **bSolid's dialect is proprietary.** The label set above follows common
   Biesse conventions but must be verified against **your** bSolid version and
   post-processor. Different Rover generations and bSolid releases accept
   different header blocks, tool-change macros and aggregate syntax.
2. **Header/post-processor blocks.** The `prelude` and `postlude` functions in
   `src/cix.ts` are the intended place for your machine's program header
   (program number, tool table, vacuum, safe-Z, reference point). They are
   deliberately isolated so they can be edited without touching geometry logic.
3. **Tool mapping.** `src/settings.ts` holds the tooling table (router Ø,
   boring-block Ø, aggregate). The compiler currently references operations by
   unit (`BOR`, `AGG`, `ROUT`); a production integration should map those to
   your concrete tool/spindle numbers via `FNC`.
4. **Feed/speed.** Feed rates, spindle RPM and safe-Z moves are **not** emitted
   by this MVP — bSolid usually layers those from its own tooling database, but
   confirm this for your install.
5. **Drill depth.** Face-drill depth defaults to a blind boring depth and is
   overridden by the assembly/hardware table where present. Through-holes are
   flagged as warnings in pre-flight.
6. **Nesting software.** Files are named `<PART-ID>.cix` with alphanumeric IDs
   (`A-Z`, `0-9`, `.`, `_`, `-`) so third-party nesting tools can batch-load
   them without path/filename issues.

## Where the format lives

- Compiler: `src/cix.ts` (`compilePanel`, `compileProject`)
- Tooling defaults: `src/settings.ts`
- Validation that gates compilation: `src/validate.ts`

To adapt to a verified machine format, implement a new block emitter and swap it
in `compilePanel` — the parse/validate/report pipeline is independent of the
CIX syntax.
