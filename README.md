# Pac-Man+

Pac-Man+ is a fully three-dimensional version of the classic arcade game, built in tiny-graphics using animation techniques. 
The player navigates a 3D maze, collects pellets, avoids ghosts, and triggers power-ups

Our project uses **tiny-graphics.js** and is intended to run in a Chromium-based browser.

## Running the Project
### WebStorm (preferred method)

This is the **recommended setup** and the one we personally used.

1. Download and extract the project archive
2. Open the **project folder directly** in WebStorm.
3. In the top-right run configuration menu:

    * Select **Run -> Debug**.
    * Choose **`index.html`** as the debug target.
4. WebStorm will launch the page in a browser with full debugging support.
---

### VSCode (alternative method)

For VSCode usage, follow these steps:

#### 1. Install Live Server

Install the **Live Server** extension:

https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer

---

#### 2. Add Debug Configuration

Create or edit:

```
.vscode/launch.json
```

Add the following:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "pwa-chrome",
      "request": "launch",
      "name": "Debug Live Server",
      "url": "http://127.0.0.1:5500",
      "webRoot": "${workspaceFolder}"
    }
  ]
}
```

Note: **5500 is the default port used by Live Server.**

---

#### 3. Run the Project

1. Click **"Go Live"** in the bottom-right corner of VS Code.
2. Open the **Run and Debug panel** on the left.
3. Select **"Debug Live Server"**.
4. Click the **green run button**.
