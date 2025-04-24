const { writeFileSync } = require("fs");

const data = {
  "files": []
}
for (const file of data.files) {
  writeFileSync(file.path, file.content);
}
