var util = require('util');
var EventEmitter = require('events').EventEmitter;
var debug = require('debug')('wemo-client');
var SSDPClient = require('node-ssdp').Client;
var url = require('url');
var http = require('http');
var os = require('os');
var ip = require('ip');

var WemoClient = require('./client');

var Wemo = function (opts) {
  EventEmitter.call(this);
  opts = opts || {};
  this._port = opts.port || 0;
  this._listenInterface = opts.listen_interface;
  this._callbackURL = null;

  this._listen();
  this._ssdpClient = new SSDPClient(opts.discover_opts || {});
};

util.inherits(Wemo, EventEmitter);

Wemo.DEVICE_TYPE = {
  Bridge: 'urn:Belkin:device:bridge:1',
  Switch: 'urn:Belkin:device:controllee:1',
  Motion: 'urn:Belkin:device:sensor:1',
  Maker: 'urn:Belkin:device:Maker:1',
  Insight: 'urn:Belkin:device:insight:1',
  LightSwitch: 'urn:Belkin:device:lightswitch:1',
  Dimmer: 'urn:Belkin:device:dimmer:1',
  Humidifier: 'urn:Belkin:device:Humidifier:1',
  HeaterB: 'urn:Belkin:device:HeaterB:1'
};

Wemo.prototype.load = function (setupUrl, cb) {
  var self = this;
  var location = url.parse(setupUrl);

  WemoClient.request({
    host: location.hostname,
    port: location.port,
    path: location.path,
    method: 'GET'
  }, function (err, json) {
    if (!err && json) {
      var device = json.root.device;
      device.host = location.hostname;
      device.port = location.port;
      debug('Found device: %j', json);
      !!cb && cb.call(self, err, device);
    } else {
      debug('Error occurred connecting to device at %s', location);
      !!cb && cb.call(self, err, null);
    }
  });
};

Wemo.prototype.discover = function (cb) {
  var self = this;
  var handleResponse = function (msg, statusCode, rinfo) {
    if (msg.ST && msg.ST === 'urn:Belkin:service:basicevent:1') {
      self.load(msg.LOCATION, cb);
    }
  };

  this._ssdpClient.removeAllListeners('response');
  this._ssdpClient.on('response', handleResponse);
  this._ssdpClient.search('urn:Belkin:service:basicevent:1');
};

Wemo.prototype._listen = function () {
  var serverCallback = function (err) {
    if (err) {
      throw err;
    }
  };

  this._server = http.createServer(this._handleRequest.bind(this));
  if (this._listenInterface) {
    this._server.listen(this._port, this.getLocalInterfaceAddress(), serverCallback);
  } else {
    this._server.listen(this._port, serverCallback);
  }
};

Wemo.prototype._handleRequest = function (req, res) {
  var body = '';
  var udn = req.url.substring(1);

  if (req.method == 'NOTIFY') {
    req.on('data', function (chunk) {
      body += chunk.toString();
    });
    req.on('end', function () {
      debug('Incoming Request for %s: %s', udn, body);
      this.emit('handleCallback', udn, body);
      res.writeHead(204);
      res.end();
    }.bind(this));
  }
};

Wemo.prototype.getLocalInterfaceAddress = function (targetNetwork) {
  var interfaces = os.networkInterfaces();
  if (this._listenInterface) {
    if (interfaces[this._listenInterface]) {
      interfaces = [interfaces[this._listenInterface]];
    } else {
      throw new Error('Unable to find interface ' + this._listenInterface);
    }
  }
  var addresses = [];
  for (var k in interfaces) {
    for (var k2 in interfaces[k]) {
      var address = interfaces[k][k2];
      if (address.family === 'IPv4' && !address.internal) {
        if (targetNetwork && ip.subnet(address.address, address.netmask).contains(targetNetwork)) {
          addresses.unshift(address.address);
        } else {
          addresses.push(address.address);
        }
      }
    }
  }
  return addresses.shift();
};

Wemo.prototype.getCallbackURL = function (opts) {
  opts = opts || {};
  if (!this._callbackURL) {
    var port = this._server.address().port;
    var host = this.getLocalInterfaceAddress(opts.clientHostname);
    this._callbackURL = 'http://' + host + ':' + port;
  }
  return this._callbackURL;
};

Wemo.prototype.client = function (device) {
  device.callbackURL = this.getCallbackURL({ clientHostname: device.host });
  return new WemoClient(this, device);
};

module.exports = Wemo;
