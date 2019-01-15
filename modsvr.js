"use strict";
const DEVNUM = 1 ;
const TAGNUM = 100 ;
const GWIP = "192.168.8.100" ;
const TAGPORT = 1502;
const DEVPORT = 1503;
const MAXTAGS = 30 ;

const path = require('path');
const express    = require('express');
const app        = express();
const bodyParser = require('body-parser');
require('date-utils');

let apinfo = require('./api/apinfo');
let tags = require('./api/tags');
let rdata = new Uint16Array() ;

const ModbusRTU = require("modbus-serial");
const client = new ModbusRTU();

// Middlewares
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));
app.use(function (req, res, next) { //1
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.header('Access-Control-Allow-Headers', 'content-type');
  next();
});

// API

app.get('/', (req, res) => {
  res.send('Hello 바가지 희안하다!\n');
 });

 app.get('/tags', (req, res) => {
   console.log("request :" + req.originalUrl + " " + req.ip) ;
   res.json(tags)  ;
   if (client.isOpen) tags = [];
 });

 app.get('/apdevs', (req, res) => {
   console.log("request :" + req.originalUrl + " " + req.ip) ;
   res.json(getDevs())  ;
 });

// Server
let port = process.argv[2] || 9988;
app.listen(port, function(){
  console.log('listening on port:' + port);
});

function getDevs() {
  const cli_dev = new ModbusRTU();
  cli_dev.connectTCP(GWIP, { port: DEVPORT })
  .then(() => {
      cli_dev.readInputRegisters(1, DEVNUM*6)
      .then( (d) => {
        let rapdev = new Uint16Array(d.data);
        apinfo = [];
        for (let i=0; i < rapdev.length ; i += 6) {
          let d = (Math.floor( i / 6) + 1);
          let vmac = (rapdev[i] & 255).toString(16).padStart(2,'0') +':' + (rapdev[i] >>>8).toString(16).padStart(2,'0') + ':'
                   + (rapdev[i+1] & 255).toString(16).padStart(2,'0') +':' + (rapdev[i+1] >>>8).toString(16).padStart(2,'0') + ':'
                   + (rapdev[i+2] & 255).toString(16).padStart(2,'0') +':' + (rapdev[i+2] >>>8).toString(16).padStart(2,'0') + ':'
                   + (rapdev[i+3] & 255).toString(16).padStart(2,'0') +':' + (rapdev[i+3] >>>8).toString(16).padStart(2,'0') ;
          let vbatt = rapdev[i+5] * 100 / 3600 ;
          apinfo.push({"apdev": d, "mac":vmac, "act" : rapdev[i+4], "batt" : vbatt.toFixed(2)  });
        }
      })
      .then ( () => {cli_dev.close();
      })
      .catch( (e) => {
        console.error( "apdev register read error");
        console.info(e);
      });
  })
  .catch((e) => {
    console.error(DEVPORT + " port conn error");
  });

  return apinfo ;
}

function checkError(e) {
    if(e.errno && networkErrors.includes(e.errno)) {
        console.log("we have to reconnect");

        // close port
        client.close();

        // re open client
        client = new ModbusRTU();
        connect() ;
    }
}

// open connection to a serial port
function connect() {

    // if client already open, just run
    if (client.isOpen) {
        return;
    }

    // if client closed, open a new connection
    client.connectTCP(GWIP, { port: TAGPORT })
        .then(function() {
            console.log("Connected");
            tags = [];
          })
        .catch(function(e) {
            console.log(TAGPORT + " port conn error"); });
}

function getTags() {

// open connection to a tcp line
  if (! client.isOpen)  connect() ;

  client.setID(1);
  if ( client.isOpen) {
//    rdata = [];
//    for (let ii = 1 ; ii < DEVNUM*TAGNUM*2 ; ii += 50) {
      client.readInputRegisters(1, 50)
        .then( function(d) {
            rdata = new Uint16Array(d.data);
            creTags();
        })
        .catch(function(e) {
    //            checkError(e);
                console.error("read register error");
                console.info(e); });
//     }
    } else {
      const today = new Date();
      tags[0].tm = today.toFormat('HH24:MI:SS');
    }
}

function creTags() {
    const today = new Date();
    const tm = today.toFormat('HH24:MI:SS');

    let taglist = new Array();
    let aplist = new Array();
    let vbatt = 0, vrssi = 0, vsos = 0 ,vd = 0;

    for (let x = 0; ; x += 2) {
      let d = (Math.floor(x / (TAGNUM*2)) + 1)  ;
      if(vd != d && taglist.length || x>=rdata.length) {
        aplist.push({apdev:vd, tags:taglist}) ;
        tags.push({"tm":tm, apdevs:aplist});
        aplist = [] ;
      }
      if (x>=rdata.length) break ;
      vd = d;
      if (rdata[x] === 0) continue ;
      let i = x % (TAGNUM*2) ;
      vrssi = rdata[i+1] >>> 8 ;
      vsos  = (rdata[i+1] >>> 7) & 0x01 ;
      vbatt = rdata[i+1] & 0x7f ;
      taglist.push({tagid:rdata[i], rssi:-vrssi, sos:vsos, batt: vbatt }) ;
    }

    if (tags.length >= MAXTAGS) {
      const result = tags.shift() ;
      console.log("삭제: " + result.tm );
    }
}
let timerId = null;
getTags() ;

timerId = setInterval(getTags, 5000);
