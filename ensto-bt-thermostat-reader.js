const noble = require("@abandonware/noble");
const fs = require("fs");

// const CUSTOM_SERVICE_UUID = "f49cefd5-209b-4531-99bd-89fe2909931a"; // 2.2. Thermostat Custom Service
const RESET_CHAR_UUID = "f366dddbebe243ee83c0472ded74c8fa"; // 2.2.21. Device factory reset ID
const STATS_CHAR_UUID = "66ad3e6b31354adabb2b8b22916b21d4"; // 2.2.23. Real Time Indication temperature and mode
const DNAME_CHAR_UUID = "2a00"; // 2.1.2. Device name

const dieOnError = (error) => {
  console.error(error, "Error");
  process.exit(1);
};

process
  .on("unhandledRejection", dieOnError)
  .on("uncaughtException", dieOnError);

function usage() {
  console.warn(`USAGE:
  
  # find devices
  node ensto-bt-thermostat-reader.js --scan

  # read thermostat data
  node ensto-bt-thermostat-reader.js --read <device-address>

  Common options:
  --verbose         - for more logging to stderr.
  --keep-reading    - stay alive, loop reading and printing the data.


This program attempts to connect to an Ensto ECO16BT (possibly also ECO10BTW,
ELTE6-BT, EPHE5-BT) Bluetooth thermostat.

With "--scan", it scans for devices and prints a list of found thermostats,
never quitting.

With "--read <device-address>" (e.g. "--read 90:fd:9f:12:34:56"), it attempts
to connect to the device and print some characteristics, e.g.

    {
        "address": "90:fd:9f:12:34:56",
        "deviceName": "Livingroom",
        "relayIsOn": false,
        "roomTemperature": 20.5,
        "targetTemperature": 19.5,
        "timestamp": "2021-12-31T12:34:56.789Z"
    }

Pairing a device:

1) Identify the device id by running this program with "--scan" or by
   reading it via Ensto Heat mobile app (tap three dots, then tap on
   "Information...").
2) Enable pairing mode by pulling out the potentiometer on the device and
   pushing the button for more than 0.5 and less then 7 seconds. A blue LED
   will start blinking.

3) While the blue LED blinks, run:

   node ensto-bt-thermostat-reader.js --read device-address

   This will pair the device and write pairing information to a file, e.g.
   "pairing-90fd9f123456.json".

KNOWN BUGS

For some reason, the first "--read" attempt seems to always (?) fail.
Just retry it right away, and it (usually) works.

`);
  process.exit(1);
}

function pairingFilename(deviceAddress) {
  return `pairing-${deviceAddress.replace(/:/g, "")}.json`;
}

// NB: throws if the file is not found
function readPairingInfo(deviceAddress) {
  const filename = pairingFilename(deviceAddress);
  log(2, `reading ${filename}`);
  return JSON.parse(String(fs.readFileSync(filename)));
}

function writePairingInfo(deviceAddress, resetCode) {
  const filename = pairingFilename(deviceAddress);
  const data = JSON.stringify({ resetCode });
  log(2, `writing '${data}' to ${filename}`);
  fs.writeFileSync(filename, data);
}

let mode; // 'SCAN' or 'READ'
let targetDeviceAddress;
let verbosity = 0;
let keepReading = false;

function log(level, ...msg) {
  if (level <= verbosity) console.warn(...msg);
}

const args = process.argv.slice(2);
while (args.length) {
  const arg = args.shift();
  if (arg === "--read") {
    targetDeviceAddress = args.shift().toLowerCase();
    if (
      !/^[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}$/i.test(
        targetDeviceAddress
      )
    ) {
      usage();
    }
    if (mode) usage();
    mode = "READ";
  } else if (arg === "--keep-reading") {
    keepReading = true;
  } else if (arg === "--scan") {
    if (mode) usage();
    mode = "SCAN";
  } else if (arg === "--verbose") {
    verbosity++;
  } else {
    usage();
  }
}

if (!mode) {
  usage();
}

noble.on("stateChange", (state) => {
  if (state === "poweredOn") {
    if (mode === "READ") {
      log(1, `Searching for ${targetDeviceAddress}`);
    } else {
      // "SCAN"
      log(0, "Scanning, press ctrl-c to quit...");
    }
    noble.startScanning();
  } else {
    noble.stopScanning();
  }
});

noble.on("discover", async (peripheral) => {
  const { address } = peripheral;
  const { localName, manufacturerData } = peripheral.advertisement;

  // We are only interested in these devices.
  // (TODO: add other models if needed.)
  if (!/^ECO16BT /.test(localName)) {
    return;
  }
  // when the button is pushed, manufacturerData looks like
  // 'ECO16BT;1;0;0;' where "1" is PAIRING.
  const pairing = manufacturerData[10] === 49; // ascii "1"

  if (mode === "SCAN") {
    log(0, `Found ${address} (${localName}), pairing=${pairing}`);
  } else {
    // mode === 'READ'
    if (address === targetDeviceAddress) {
      log(1, "Found target device, stopping scanning");
      await noble.stopScanningAsync();
      peripheral.once("disconnect", () => {
        log(0, "Error: device disconnected, exiting");
        process.exit(1);
      });
      await connect(peripheral, pairing);
    }
  }
});

async function connect(peripheral, pairing) {
  log(1, `Connecting`);
  await peripheral.connectAsync();

  // no idea why this does not work:
  // const {characteristics} = await peripheral.discoverSomeServicesAndCharacteristicsAsync([CUSTOM_SERVICE_UUID], [RESET_CHAR_UUID])

  log(2, "Discovering services and characteristics");
  const { characteristics } =
    await peripheral.discoverAllServicesAndCharacteristicsAsync();

  const resetChar = characteristics.find((c) => c.uuid === RESET_CHAR_UUID);
  const statsChar = characteristics.find((c) => c.uuid === STATS_CHAR_UUID);
  const dnameChar = characteristics.find((c) => c.uuid === DNAME_CHAR_UUID);

  log(3, "Characteristics", ...characteristics);

  let resetCode;
  if (pairing) {
    log(0, "Pairing...");

    const resetCharMsgFromDevice = await resetChar.readAsync();

    log(1, "Received reset code", resetCharMsgFromDevice);

    // factory reset id is the first four bytes
    resetCode = [...resetCharMsgFromDevice.slice(0, 4)];

    // store pairing info for later use
    writePairingInfo(peripheral.address, resetCode);
    log(0, "Pairing successful.");
  } else {
    try {
      resetCode = readPairingInfo(peripheral.address).resetCode;
    } catch (e) {
      log(
        1,
        `Existing pairing info not found for ${peripheral.address}. ` +
          `Please enable pairing on the device and try again.`
      );
      process.exit(1);
    }
  }

  log(1, `Authenticating with reset code ${JSON.stringify(resetCode)}`);
  await resetChar.writeAsync(Buffer.from(resetCode), false);

  // Read device name (possibly set by the user via Ensto Heat app)
  const deviceName = (await dnameChar.readAsync())
    .slice(1)
    .toString()
    .replace(/\x00/g, "");

  do {
    const stats = await statsChar.readAsync();
    log(2, "Received stats", stats);

    // Stats are sent in two packets. We are interested with the first one,
    // indicated by the first byte.
    if (stats[0] === 0x80) {
      const targetTemperature = (256 * stats[2] + stats[1]) / 10;
      const roomTemperature = (256 * stats[5] + stats[4]) / 10;
      // const floorTemperature = (256 * stats[7] + stats[6]) / 10;
      const relayIsOn = stats[8] === 1;
      console.log(
        JSON.stringify({
          address: peripheral.address,
          deviceName,
          relayIsOn,
          roomTemperature,
          targetTemperature,
          timestamp: new Date(),
        })
      );
    }
    if (keepReading) {
      log(2, "Waiting...");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } while (keepReading);
  process.exit(0);
}
