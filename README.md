# Smith Chart

Interactive Smith chart for RF/microwave work. Toggle impedance and admittance
grids, adjust the grid resolution, and hover anywhere to read the normalized
impedance/admittance, reflection coefficient, and VSWR at that point.

## Features

- White chart background (both light and dark site themes).
- Toggle the impedance (r, x) and admittance (g, b) grids independently.
- Adjustable grid resolution (Coarse → Dense).
- Live hover readout with crosshair, Γ vector, and constant-VSWR circle.
- Configurable reference impedance Z₀ for denormalized Ω / mS values.

## Running Locally

Open `index.html` directly in a browser, or run a local static file server:

```bash
npx serve
```
