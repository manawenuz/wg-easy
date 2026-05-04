const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const conn = new Client();
const key = fs.readFileSync(path.join(__dirname, '../../node_modules/wzp'));

conn.on('ready', () => {
  console.log('SSH Ready');
  conn.exec('docker images', (err, stream) => {
    if (err) throw err;
    stream.on('close', () => conn.end()).on('data', (data) => {
      console.log('CONTAINERS:\n' + data);
    });
  });
}).connect({
  host: '188.245.59.196',
  port: 22,
  username: 'root',
  privateKey: key
});
