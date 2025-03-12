const fs = require("fs");
const path = require("path");

function createDirectories() {
    const directories = ["voice_notes", "images", "files"];
    const basePath = __dirname; // Current directory where script is running

    directories.forEach((dir) => {
        const dirPath = path.join(basePath, dir);
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
            console.log(`Created: ${dirPath}`);
        } else {
            console.log(`Already exists: ${dirPath}`);
        }
    });
}

module.exports = createDirectories;
