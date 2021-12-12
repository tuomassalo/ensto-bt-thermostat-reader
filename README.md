# Ensto BT Thermostat Reader

This program attempts to connect to an Ensto ECO16BT (possibly also other models such as ECO10BTW, ELTE6-BT, EPHE5-BT) Bluetooth thermostat and read temperature and other data.

## Tested with:

- RPi 3 Model B v1.2
- Raspbian 10
- Node 16.13.0

## How to use

- Follow `noble` installation instructions here: https://www.npmjs.com/package/@abandonware/noble#installation
- run `npm i`
- run `node ensto-bt-thermostat-reader`

## Resources

The document `Ensto_BT_IOT_interface_specification.pdf` (not anymore available at Ensto website) was used to find out UUIDs and other functionality. Same information could have been obtained by reverse engineering the Ensto Heat mobile app.
