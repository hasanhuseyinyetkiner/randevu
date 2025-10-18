const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Determine which file to serve
  // Remove query string from URL
  let filename = req.url.split('?')[0];
  filename = filename === '/' ? '/index.html' : filename;
  const filePath = path.join(__dirname, filename);
  
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('File not found');
      return;
    }
    
    // Determine content type
    const ext = path.extname(filePath);
    const contentType = ext === '.html' ? 'text/html' : 'text/plain';
    
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Frontend çalışıyor: http://localhost:${PORT}`);
  console.log(`📝 n8n backend: http://localhost:5678`);
  console.log(`\n📄 Sayfalar:`);
  console.log(`   Admin:  http://localhost:${PORT}/admin.html`);
  console.log(`   Doktor: http://localhost:${PORT}/doktor.html`);
  console.log(`   Hasta:  http://localhost:${PORT}/hasta.html`);
});
