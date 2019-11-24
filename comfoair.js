'use strict';

const Comfoair = require('comfoair');
const events = require('events');

module.exports = function (RED) {
    const settings = RED.settings;

    function ComfoairNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.comfoairDatasource = RED.nodes.getNode(config.datasource);
        if (node.comfoairDatasource) {
            node.comfoair = comfoairPool.get(this.comfoairDatasource.serialport,
                this.comfoairDatasource.serialbaud);

            node.comfoair.on('error', function (err) {
                return RED.log.error(`comfoair [${node.comfoair.port}] emmited error: ${err.message}`);
            });

            node.comfoair.on('ready', function () {
                node.status({
                    fill: 'green',
                    shape: 'dot',
                    text: 'node-red:common.status.connected'
                });
            });

            node.comfoair.on('closed', function () {
                node.status({
                    fill: 'red',
                    shape: 'ring',
                    text: 'node-red:common.status.not-connected'
                });
            });

            node.on('input', function (msg) {
                if (msg.hasOwnProperty('payload')) {
                    if (typeof msg.payload.name !== 'string') return node.error('Invalid data for msg.payload.name. Expect a function name as string.', msg);
                    if (typeof msg.payload.params !== 'object') return node.error('Invalid data for msg.payload.params. Expect an object.', msg);
                    if (!node.comfoair.isValidFunction(msg.payload.name)) return node.error(`Input '${msg.payload.name}' is no valid function name.`, msg);

                    node.comfoair.runCommand(msg.payload.name, msg.payload.params, (err, resp) => {
                        if (err) {
                            const errMsg = `comfoair [${node.comfoair.port}] runCommand(${msg.payload.name}): ${err.message}`;
                            return node.error(errMsg, msg);
                        }
                        if (resp) {
                            msg.payload = resp.payload || {};
                            msg.payload.type = resp.type;
                            return node.send(msg);
                        }
                    });
                }
            });
        } else {
            this.error(RED._('comfoair.errors.missing-conf'));
        }
        node.on('close', function (done) {
            if (node.comfoairDatasource) {
                comfoairPool.close(node.comfoairDatasource.serialport, done);
            } else {
                done();
            }
        });
    }
    RED.nodes.registerType('comfoair', ComfoairNode);

    const comfoairPool = (function () {
        const connections = {};
        return {
            get(port, baud) {
                // just return the connection object if already have one
                // key is the port (file path)
                const id = port;
                if (connections[id]) return connections[id];
                
                connections[id] = (function () {
                    const obj = {
                        _emitter: new events.EventEmitter(),
                        comfoair: null,
                        _closing: false,
                        tout: null,
                        port,
                        on(eventName, cb) {
                            this._emitter.on(eventName, cb);
                        },
                        close(cb) {
                            this.comfoair.close(cb);
                        },
                        runCommand(name, params, cb) {
                            this.comfoair.runCommand(name, params, cb);
                        },
                        isValidFunction(name) {
                            return (typeof this.comfoair[name] === 'function');
                        }
                    };
                    let olderr = '';
                    const setupComfoair = function () {
                        obj.comfoair = new Comfoair({
                                port,
                                baud
                            },
                            function (err) {
                                if (err) {
                                    if (err.toString() !== olderr) {
                                        olderr = err.toString();
                                        RED.log.error(RED._('comfoair.errors.error', {
                                            port,
                                            error: olderr
                                        }));
                                    }
                                    obj.tout = setTimeout(function () {
                                        setupComfoair();
                                    }, settings.serialReconnectTime);
                                }
                            });
                        obj.comfoair.on('error', function (err) {
                            RED.log.error(RED._('comfoair.errors.error', {
                                port,
                                error: err.toString()
                            }));
                            obj._emitter.emit('closed');
                            obj.tout = setTimeout(function () {
                                setupComfoair();
                            }, settings.serialReconnectTime);
                        });
                        obj.comfoair.on('close', function () {
                            if (!obj._closing) {
                                RED.log.error(RED._('comfoair.errors.unexpected-close', {
                                    port
                                }));
                                obj._emitter.emit('closed');
                                obj.tout = setTimeout(function () {
                                    setupComfoair();
                                }, settings.serialReconnectTime);
                            }
                        });
                        obj.comfoair.on('open', function () {
                            olderr = '';
                            RED.log.info(RED._('comfoair.onopen', {
                                port,
                                baud
                            }));
                            if (obj.tout) {
                                clearTimeout(obj.tout);
                            }
                            obj._emitter.emit('ready');
                        });
                        obj.comfoair.on('data', function (d) {
                            obj._emitter.emit('data', d);
                        });
                    };
                    setupComfoair();
                    return obj;
                }());
                return connections[id];
            },
            close(port, done) {
                if (connections[port]) {
                    if (connections[port].tout != null) {
                        clearTimeout(connections[port].tout);
                    }
                    connections[port]._closing = true;
                    try {
                        connections[port].close(function () {
                            RED.log.info(RED._('comfoair.errors.closed', {
                                port
                            }));
                            done();
                        });
                    } catch (err) {
                        RED.log.error(err);
                    }
                    delete connections[port];
                } else {
                    done();
                }
            }
        };
    }());
};

