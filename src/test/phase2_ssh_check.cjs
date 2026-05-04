const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const conn = new Client();

const key = fs.readFileSync(path.join(__dirname, '../../node_modules/wzp'));

conn.on('ready', () => {
  console.log('SSH Connection Ready');
  conn.exec('uname -a && which wg && which tc', (err, stream) => {
    if (err) throw err;
    stream.on('close', (code, signal) => {
      console.log('Stream :: close :: code: ' + code + ', signal: ' + signal);
      conn.end();
    }).on('data', (data) => {
      console.log('STDOUT: ' + data);
    }).stderr.on('data', (data) => {
      console.log('STDERR: ' + data);
    });
  });
}).connect({
  host: '188.245.59.196',
  port: 22,
  username: 'root',
  privateKey: key
});
