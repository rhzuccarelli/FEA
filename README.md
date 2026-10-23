# FEA
FEA Structural Simulation

## Web UI for code_aster (`webui/`)

A browser front end for the [code_aster](https://gitlab.com/codeaster/src) finite element solver.
It starts with a simple part, a rectangular block meshed with hexahedra, and walks through:

1. **Part**: block dimensions and mesh density.
2. **Material**: presets (steel, aluminium, titanium, concrete) or custom E / ν / ρ.
3. **Supports & loads**: click a face in the 3D view (or in the list) to make it fixed, a roller or sliding,
   or to apply a pressure or a total force. Optional self-weight.
4. **Analysis**: linear static (`MECA_STATIQUE`) or modal (`CALC_MODES`).

Results are shown in the 3D viewer: deformed shape, a contour plot of displacement or von Mises stress,
animated mode shapes, max values and support reactions. The **Command file** tab shows the generated
code_aster `.comm` file, which you can edit before running. The **Solver log** tab shows the run output and
download links (`.comm`, mesh, `.rmed` results for ParaView/Salome, `.mess`).

### Running it on Windows

In PowerShell, from the `webui` folder:

```powershell
python -m pip install -r requirements.txt
.\scripts\install_code_aster.cmd   # one-off: code_aster from conda-forge into %USERPROFILE%\fea-aster (~260 MB)
.\scripts\serve.cmd                # then open http://localhost:8000
```

(The `.sh` scripts are for Linux/macOS; on Windows use the `.cmd` ones.)

### Running it on Linux

```bash
cd webui
pip install -r requirements.txt
./scripts/install_code_aster.sh      # one-off: code_aster from conda-forge into webui/.aster
./scripts/serve.sh                   # http://localhost:8000
```

The server finds code_aster installed by these scripts automatically. If it is installed elsewhere, set
`CODE_ASTER_RUN=/path/to/run_aster` (`run_aster.bat` on Windows).
Runs are stored in `webui/runs/` (override with `FEA_RUNS_DIR`).

### Why not GitHub Pages?

GitHub Pages only serves static files to the browser. code_aster is a native Fortran/C++ program that has to
run on a real machine, so the page needs the small Python server next to it. You can run that server on your own
PC (as above) or on any Linux server or cloud VM to share it with others.

### Layout

- `backend/case.py`: mesh generator (ASTER mesh format) and `.comm` / `.export` builders.
- `backend/server.py`: FastAPI app that runs `run_aster` in the background and serves results as JSON.
- `static/`: the single-page front end (plain ES modules + three.js, no build step).

Default case: a 1 m × 0.1 m × 0.1 m steel cantilever with a 1 kN tip load. code_aster gives a tip
deflection of 0.172 mm (Euler–Bernoulli beam theory: 0.190 mm; linear hexahedra are slightly stiff) and a
first bending frequency of 88 Hz (beam theory: 83.5 Hz).
