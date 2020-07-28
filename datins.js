"use strict";
let DEVNUM = 2 ;
let SSNUM = 6 ;
const TAGPORT = 3000;
const DEVPORT = 1503;
const _argv = process.argv ;

const moment = require('moment') ;
const express    = require('express');
const app        = express();
const net = require('net');
app.use(express.json()) ;

const mysql_dbc = require('./db/db_con')();
let con = mysql_dbc.init();
mysql_dbc.test_open(con);
con.isconn = true ;

require('date-utils');

let moteinfo = require('./api/moteinfo');
let apinfo = require('./api/apinfo');
let rdata = new Uint16Array(DEVNUM) ;
let MEAS = 5;
let svtime = moment().subtract(34,"s");

//let GWIP = process.argv[2] || "192.168.8.98" ;
let GWIP = process.env.GWIP || "192.168.0.233" ;
let port = process.env.RESTPORT || 9977 ;
console.info( "GateWay :" + GWIP);

const sleep = (ms) => new Promise(resolve => setTimeout(resolve  , ms) );
const ModbusRTU = require("modbus-serial");
const client = new ModbusRTU();

let motesmac = [];
let sno = [];

app.get('/', (req, res) => {
  res.send('<h2>(주)다윈아이씨티 : Posco TR Strain Monitoring 입니다  </h2>\n');
//  console.info(req.query) ;
  if (req.query.meas != null)  MEAS = req.query.meas ;
  console.info('time interval :'+ MEAS);
 });

app.get('/zero', (req, res) => {
   res.send('<h2>Sensor zeroing</h2>\n');
   if (req.query.mac != null) {
      console.info('Sensor Zeroing :' + req.query.mac);
      moteZerOne(req.query.mac) ;
   } else {
     console.info('Sensor Zeroing all');
     moteZeroing() ;
   }

});

app.get('/reset_ob', (req, res) => {
   res.send('<h2>Sensor OB reset</h2>\n');
   if (req.query.sensorNo != null) {
      console.info('Sensor OB reset :' + req.query.sensorNo);
      moteOBReset(req.query.sensorNo) ;
   } else {
     console.error('Sensor OB reset sensor No not input !!');
   }

});

async function moteZeroing() {
    let dl = 0;
    motesmac.filter((m) => m.mac.indexOf("00:00:00:00") == -1).forEach( (m) => {
    // for (const m of motesmac) {
    //   if ( m.mac.indexOf("00:00:00:00") == -1) {
        con.query (' INSERT INTO MOTEZEROT (seq, tm) SELECT seq , now() from motestatus where mac = ? limit 1 ', [m.mac]);
        setTimeout( () =>  mote_reset(m.mac, 0) , dl * 2000 ) ;
        setTimeout( () => {
          let ftm = svtime.format('YYYY-MM-DD HH:mm:ss.S');
          con.query('SELECT cast(avg(temp) as int) AS avg from moteinfo where sensorNo = ? \
                     AND tm > date_add( ? , interval -15 SECOND) ' ,[m.sensorNo, ftm ],
            async (err, dt) => {
              if (!err) {
                await mote_reset(m.mac, dt[0].avg ? dt[0].avg : 0 ) ;
              }
              else  console.error(err);
            });

          } , 30000 + dl * 2000 ) ;

        dl++ ;
      // }
    });
/*
    setTimeout( () => { motesmac.filter((m) => m.mac.indexOf("00:00:00:00") == -1).forEach((m) => {
      let ftm = svtime.format('YYYY-MM-DD HH:mm:ss.S');
      con.query('SELECT cast(avg(temp) as int) AS avg from moteinfo where sensorNo = ? \
                 AND tm > date_add( ? , interval -15 SECOND) ' ,[m.sensorNo, ftm ],
        async (err, dt) => {
          if (!err) {
            await mote_reset(m.mac, dt[0].avg ? dt[0].avg : 0 ) ;
          }
          else  console.error(err);
        });

    }) } , 30000) ;
    */

}

function moteZerOne(mac) {
    mote_reset(mac, 0) ;
    con.query (' INSERT INTO MOTEZEROT (seq, tm) SELECT seq , now() from motestatus where mac = ? limit 1 ', [mac]) ;

    setTimeout( () => {
      let ftm = svtime.format('YYYY-MM-DD HH:mm:ss.S');
      con.query('SELECT cast(avg(temp) as int) AS avg from moteinfo where sensorNo = \
                 (select sensorno from motestatus where mac = ? limit 1) AND tm > date_add( ? , interval -15 SECOND) '
                 ,[mac, ftm ],
        (err, dt) => {
          if (!err) mote_reset(mac, dt[0].avg) ;
          else  console.error(err);
        });

    } , 30000) ;
}


function moteOBReset(sno) {
      con.query('UPDATE motestatus SET obcnt = 0  where sensorNo = ? ' ,[sno ],
        (err, dt) => {
          if (err) console.error(err);
        });
}

function getMeasure() {

  con.query("SELECT measure FROM MOTECONFIG LIMIT 1",
    (err, dt) => {
      if (err) MEAS = 10 ;
      else   MEAS = dt[0].measure ;
      console.info('time interval :'+ MEAS);
  });
  con.query("SELECT count(1) as ssnum FROM motestatus where spare = 'N' and GUBUN = 'S' ",
    (err, dt) => {
      if (err) SSNUM = 6 ;
      else   SSNUM = dt[0].ssnum ;
      console.info('Sensor num :'+ SSNUM);
  });
  con.query("SELECT count(1) as devnum FROM motestatus where spare = 'N' ",
    (err, dt) => {
      if (err) DEVNUM = 6 ;
      else   DEVNUM = dt[0].devnum ;
      console.info('Mote num :'+ DEVNUM);
  });
  con.query("SELECT seq,mac,sensorNo, act, tval FROM motestatus where spare = 'N' and GUBUN = 'S'  ",
    (err, dt) => {
      if (!err) {
        // motesmac = JSON.parse(JSON.stringify(dt)) ;
        motesmac = dt ;
        motesmac.forEach((e,i) => { sno[e.sensorNo] = [] ; sno[e.sensorNo] = [ e.seq, e.act, e.tval] } ) ;
        console.info("motemac:",motesmac) ;
        console.info("sno:", sno) ;

      } else console.error(err);
  });

  con.query("SELECT lastm FROM lastime where id = 1 ",
    (err, dt) => {
      if (!err) svtime = moment(dt[0].lastm) ;
      console.info('last time :'+ svtime.format('YYYY-MM-DD HH:mm:ss.S')) ;
  });
}

/*
let motestatus = {"sensorNo": 1, "mac":"", "act" : 0, "descript": "INS" , "batt" : 3.299, "seq": 1 } ;
for (let i=1; i<=DEVNUM; i++) {
  motestatus.sensorNo = i;
  motestatus.seq = i;
  con.query('INSERT INTO motestatus SET ?', motestatus , (err, res) => { ; }
  );
}
*/

con.query( ' delete from motehist where tm < DATE_ADD( now() , interval -6 month)',
        (err,res) => { if(err) console.log(err);  } ) ;

app.listen(port, function(){
  console.log('listening on port:' + port);
});

function getDevs() {
  if (! con.isconn ) {
    con = mysql_dbc.init();
    mysql_dbc.test_open(con);
    con.isconn = true ;
  }
  const cli_dev = new ModbusRTU();
  cli_dev.connectTCP(GWIP, { port: DEVPORT })
  .then( async () => {
      let vincr = (DEVNUM*6 > 100) ? 100 : DEVNUM*6 ;
      let rapdev = [] ;
      cli_dev.setID(1);
      for (let ii = 1; ii < DEVNUM*6 ; ii += vincr) {
        await cli_dev.readInputRegisters(ii, vincr)
        .then ( (d) => { rapdev = rapdev.concat(d.data) ;})
        .catch( (e) => {
          console.error( "apdev register read error");
          console.info(e);
        });
      }
      cli_dev.close();
//      let rapdev = new Uint16Array(rdev);
      for (let i=0; i < rapdev.length ; i += 6) {
//        if ( rapdev[i] == 0) continue ;
        let d = (Math.floor( i / 6) + 1);
        let vmac = (rapdev[i] & 255).toString(16).padStart(2,'0') +':' + (rapdev[i] >>>8).toString(16).padStart(2,'0') + ':'
                 + (rapdev[i+1] & 255).toString(16).padStart(2,'0') +':' + (rapdev[i+1] >>>8).toString(16).padStart(2,'0') + ':'
                 + (rapdev[i+2] & 255).toString(16).padStart(2,'0') +':' + (rapdev[i+2] >>>8).toString(16).padStart(2,'0') + ':'
                 + (rapdev[i+3] & 255).toString(16).padStart(2,'0') +':' + (rapdev[i+3] >>>8).toString(16).padStart(2,'0') ;
        let vbatt = rapdev[i+5] / 1000 ;
        let motestatus = {"seq": d, "mac":vmac, "act" : rapdev[i+4], "batt" : vbatt  };
        try {
          sno[d][1] = rapdev[i+4] ;
        } catch (e) {

        }

        let lowcnt = (motestatus.act == 2 && motestatus.batt < 3.5) ? 1 : 0 ;
        // console.info(motestatus) ;
        con.query('UPDATE motestatus SET MAC = ?, ACT = ? , BATT = ?, LOWCNT = LOWCNT + ? where seq = ?',[motestatus.mac, motestatus.act, motestatus.batt,  lowcnt, motestatus.seq ],
         (err, res) => { if (err) console.error("Update motestatus :", err); }
       );
      }
  })
  .catch((e) => {
    console.error(DEVPORT , " port conn error");
    console.info(e);
  });

}

let avgval = new Array() ;

async function  createData(sgno, today,uint16View) {
    let motearr = new Array() ;

    today.subtract(34, "s") ;
    // console.log("chk = :" + today.format('YYYY-MM-DD HH:mm:ss.S')) ;
    await ( () => {
      for(let i=1 ; i < 350 ; i++) {
        if ((i % 35) == 0) continue ;
        today.add(100, "ms") ;
        if (today.isAfter(svtime)) {
          let tm = today.format('YYYY-MM-DD HH:mm:ss.S');
          let t = uint16View[i] ;

          if ( sno.length > sgno) motearr.push(  [ sgno,   sno[sgno][1],  tm , t, sno[sgno][0] ] ) ;
          // process.stdout.write(t + "=" + t.toString(16) + ", ") ;
        }
      }
      // console.log("ccc ", today) ;
    })();
    if ( motearr.length > 0 ) {
      let tm = motearr[0][2];
      con.query('INSERT INTO moteinfo (sensorNo, act,  tm, temp, seq  ) values ?', [motearr],
         (err, res) => { if(err) console.log(err); }
      );
    }   // else { console.log("empty motearr ")}
    return motearr ;
}
/*
function toArrayBuffer(buf) {
    var ab = new ArrayBuffer(buf.length);
    var view = new int8Array(ab);
    for (var i = 0; i < buf.length; ++i) {
        view[i] = buf[i];
    }
    return ab;
}
*/
function toArrayBuffer(buf) {
//    var ab = new ArrayBuffer(buf.length);
    var view = new Int16Array(buf.length / 2);
    for (let i = 0; i < buf.length / 2; ++i) {
        view[i] = buf.readInt16BE(i*2) ;
    }
    return view;
}

getMeasure() ;

setTimeout( main3_loop,  5000) ;

setTimeout( main2_loop,  2000) ;
setTimeout( main_loop,  3000) ;
setInterval(() => {
  con.query('INSERT INTO motehist (id, sensorNo, act,measure, stand, loc, chock , temp, tm, seq) \
             select id, sensorNo, act,measure, stand, loc, chock , temp, tm, seq \
             from moteinfo x where not exists (select 1 from motehist where id = x.id) ',
   (err, res) => { if(err) console.log(err); }
 );
}, 30000) ;
setInterval(() => {
  con.query( ' delete from moteinfo where tm < DATE_ADD( now() , interval -12 HOUR)',
          (err,res) => { if(err) console.log(err); } ) ;
}, 600000) ;

async function main_loop() {
  let tm1 = await moment();
  await sensor_set(tm1) ;

  let tm2 = moment();
  let delay = MEAS * 1000 - (tm2 - tm1) - 10 ;
  setTimeout( main_loop,  delay) ;
}

async function main2_loop() {
  let tm1 = new Date() ;
  await getDevs() ;
  let tm2 = new Date() ;
  let delay = 10000 - (tm2 - tm1) - 10 ;

  setTimeout( main2_loop,  delay) ;
}

function main3_loop() {
  let tm1 = moment();

  let dl = 0;
  motesmac.forEach( (m) => {

      setInterval( () => con.query('call SP_PEAKTREND(?)', [ m.sensorNo ],
       (err, res) => {
                        if(err) {
                          console.error("call SP_PEAKTREND :"+ err);
                        // } else {
                        //   console.log("call SP_PEAKTREND :" + m.sensorNo,  sno[ m.sensorNo][2] * 1000) ;
                        }
                  }
      ) , sno[ m.sensorNo][2] * 1000 );

  });

  let tm2 = moment();
  let delay = 60000 - (tm2 - tm1) - 10 ;

}

process.on('uncaughtException', function (err) {
	//예상치 못한 예외 처리
	console.error('uncaughtException 발생 : ' + err.stack);
  con.end() ;
  con.isconn = false ;
});

async function sensor_set( today ) {
  // return new Promise((resolve,reject) => {
  await ( () => {
    for ( let i=1; i <= SSNUM ; i++) {
      setTimeout(() => {
      let buf1 = Buffer.alloc(4);
      buf1[0] = 2;
      buf1[1] = 1;
      buf1[3] = 3;
      buf1[2] = i ;
      let socket =  net.connect( {host: GWIP, port : TAGPORT},  () => {
    //      console.info(buf1.toString('hex'));
          socket.setNoDelay(false);
          try {
            let ret =  socket.write(buf1) ;
          } catch (e) {
            console.log("socket write error :"+ e);
          }
        } );
      socket.on('data',  (data) => {
        if (_argv[2] == "log")
          console.log(i, " *** Server return data [" + data.toString('hex') + "]** Server return data end" );
          // insTemp(today, i, data.slice(9,709)) ;
          let uint16View = toArrayBuffer(data.slice(9,709)) ;
         createData(i, today, uint16View) ;
          socket.end() ;
      });
      socket.on('error', function (err) {
          console.error(buf1.toString('hex') + " : " + JSON.stringify(err));
          socket.end();
      });
    }, i * 900);
  }  ;
 })() ;

 setTimeout(() => {
   svtime = moment(today) ;
   let ftm = svtime.format('YYYY-MM-DD HH:mm:ss.S');
   con.query('UPDATE lastime SET lastm = ? where id = 1', [ ftm ],
    (err, res) => {
                     if(err) {
                       console.error("update lastime :"+ err);
                     // } else {
                     //   console.log("update lastime :" + ftm) ;
                     }
               }
   );
 },2200);
}

function delay_loop(i, today) {
  let buf1 = Buffer.alloc(4);
  buf1[0] = 2;
  buf1[1] = 1;
  buf1[3] = 3;
  buf1[2] = i ;
  let socket = net.connect( {host: GWIP, port : TAGPORT},  () => {
//      console.info(buf1.toString('hex'));
      socket.setNoDelay(false);
      try {
        let ret =  socket.write(buf1) ;
      } catch (e) {
        console.log("socket write error :"+ e);
      }
    } );
  socket.on('data', async function (data) {
      // console.log(" *** Server return data : " + data.toString('hex') );
      await insTemp(today, i, data.slice(9,709)) ;
      socket.end() ;
  });
  socket.on('error', function (err) {
      console.error(buf1.toString('hex') + " : " + JSON.stringify(err));
      socket.end();
  });
}


function mote_reset(mac, val) {

    let lmac = mac.replace(/:/gi,'');
    console.log("mote_reset:", mac + ':' + val,  Date().toLocaleString() ) ;
    let buf1 = Buffer.alloc(13);
    buf1.write(lmac,'hex') ;
    buf1.writeUInt16BE(0x0203, 8) ;
    buf1.writeUInt8(0x03, 10) ;
    buf1.writeInt16BE(val, 11) ;

    let socket = net.connect( {host: GWIP, port : 40000}, () => {
        socket.setNoDelay(true);
        try {
          let ret = socket.write(buf1) ;
        } catch (e) {
          console.log("socket write error :"+ e);
        }
      } );
    socket.on('data', function (data) {
        console.log(" **mote_reset* Server return data : " + data.toString('hex') );
        socket.end();
    });
    socket.on('error', function (err) {
        console.error(mac, buf1.toString('hex') + " : " + JSON.stringify(err));
        // socket.end();
    });
}
