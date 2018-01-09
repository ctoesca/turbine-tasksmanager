"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const turbine = require("turbine");
var TbaseService = turbine.services.TbaseService;
var Ttimer = turbine.tools.Ttimer;
const Promise = require("bluebird");
var tools = turbine.tools;
var Tevent = turbine.events.Tevent;
const uuid = require("uuid");
const child_process = require("child_process");
const express = require("express");
const fs = require("fs");
const bodyParser = require("body-parser");
const request = require("request");
class TtasksManager extends TbaseService {
    constructor(name, server, config) {
        super(name, config);
        this.runningTasks = {};
        this.runningProcesses = {};
        this.httpServer = server;
        this.runningTasksDir = this.config.dataDir + "/runningTasks";
        try {
            fs.mkdirSync(this.runningTasksDir);
        }
        catch (e) {
            if (e.code != 'EEXIST')
                throw e;
        }
        this.refreshTimer = new Ttimer({ delay: 20 * 1000 });
        this.refreshTimer.on(Ttimer.ON_TIMER, this.onRefreshTimer, this);
    }
    getDefaultConfig() {
        return {
            "active": true,
            "executionPolicy": "one_per_process",
            "dataDir": __dirname + "/data/TtasksManager",
            "apiPath": "/api/tasks",
            "userAgent": "turbine"
        };
    }
    flatify() {
        return new Promise(function (resolve, reject) {
            var r = {};
            resolve(r);
        }.bind(this));
    }
    start() {
        if (this.active) {
            this.loadTasks();
            this.refreshTimer.start();
            super.start();
            this.app = express();
            this.app.use(bodyParser.json({
                limit: '50mb'
            }));
            this.app.post('/start', this._startTask.bind(this));
            this.app.post('/startSync', this._startTaskSync.bind(this));
            this.app.post('/:id/kill', this._killTask.bind(this));
            this.httpServer.use(this.config.apiPath, this.app);
        }
    }
    stop() {
        this.refreshTimer.stop();
        super.stop();
    }
    execTask(task, endCallback = null) {
        if (!this.started)
            throw "Le service TtasksManager n'est pas démarré";
        this.logger.info("Exec task", task);
        var cmd = tools.replaceEnvVars(task.path);
        if (typeof task.id == "undefined")
            task.id = uuid.v1();
        var child = child_process.spawn(cmd, task.args, {
            detached: true
        });
        child.on('error', function (error) {
            this.logger.error("************", error);
            task.stderr += error.message;
            if (endCallback)
                endCallback(error, task);
        }.bind(this));
        if (typeof child.pid == "undefined") {
            var m = "Echec démarrage de la tâche. cmd=" + cmd;
            this.logger.error(m);
            throw m;
        }
        this.runningProcesses[task.id] = child;
        task.exitCode = null;
        task.stdout = "";
        task.stderr = "";
        task.pid = child.pid;
        this.saveTask(task);
        child.stdout.on('data', function (data) {
            task.stdout += data;
        }.bind(this));
        child.stderr.on('data', function (data) {
            task.stderr += data;
        }.bind(this));
        child.on('close', function (code, signal) {
        }.bind(this));
        child.on('exit', function (code, signal) {
            var task = this.getRunningTaskByPID(child.pid);
            if (task != null) {
                this.logger.info("*************  TASK END " + task.pid);
                delete this.runningProcesses[task.id];
                if ((task.exitCode == -1) || (task.exitCode == null)) {
                    task.exitCode = code;
                    if (task.exitCode != 0) {
                        this.logger.info("task." + task.pid + ".stdout=" + task.stdout);
                        this.logger.info("task." + task.pid + ".stderr=" + task.stderr);
                    }
                    if (endCallback)
                        endCallback(null, task);
                }
                this.sendCallback(task, "END", function (error, task) {
                    this.removeTask(task.id);
                    this.logger.info("End task callback sent PID=" + child.pid + ", exitCode=" + code + ", signal=" + signal);
                }.bind(this));
            }
            else {
                this.logger.error("*************  TASK NOT FOUND " + child.pid);
            }
        }.bind(this));
        this.logger.info("Started task " + task.path + " PID=" + child.pid);
        return task;
    }
    searchTask(f) {
        var r = null;
        for (var id in this.runningTasks) {
            var task = this.runningTasks[id];
            if (f(task)) {
                r = task;
                break;
            }
        }
        return r;
    }
    killTask(id) {
        this.loadTasks();
        if (!this.started)
            throw "Le service TtasksManager n'est pas démarré";
        if (typeof this.runningTasks[id] != "undefined") {
            var task = this.runningTasks[id];
            this.logger.info("killTask " + id + " (PID=" + task.pid + ")");
            child_process.exec('taskkill /PID ' + task.pid + ' /T /F');
            if (task.stdout != "")
                task.stdout += "\n";
            task.stdout += "ABORTED";
            task.exitCode = 999;
            this.saveTask(task);
        }
        else {
            throw "La tâche " + id + " n'est pas en cours d'exécution";
        }
    }
    fileExists(path) {
        var r = false;
        try {
            var stat = fs.statSync(path);
            r = true;
        }
        catch (e) {
            if (e.code != 'ENOENT')
                throw e;
        }
        return r;
    }
    removeTask(id) {
        if (typeof this.runningTasks[id] != "undefined") {
            var task = this.runningTasks[id];
            delete this.runningTasks[id];
            var path = this.runningTasksDir + "/" + id;
            if (this.fileExists(path))
                fs.unlinkSync(path);
            var evt = new Tevent("TASK_END", task);
            this.dispatchEvent(evt);
        }
    }
    saveTask(task) {
        this.runningTasks[task.id] = task;
        var path = this.runningTasksDir + "/" + task.id;
        fs.writeFileSync(path, JSON.stringify(task));
    }
    loadTasks() {
        var files = fs.readdirSync(this.runningTasksDir);
        for (var i = 0; i < files.length; i++) {
            var fname = files[i];
            var path = this.runningTasksDir + "/" + fname;
            var json = fs.readFileSync(path);
            try {
                var data = JSON.parse(json.toString());
                if (typeof data.id == "undefined")
                    fs.unlinkSync(path);
                else
                    this.runningTasks[data.id] = data;
            }
            catch (err) {
                fs.unlinkSync(path);
                this.logger.error(err);
            }
        }
    }
    pidIsRunning(pid) {
        try {
            return process.kill(pid, 0);
        }
        catch (e) {
            return e.code === 'EPERM';
        }
    }
    getRunningTaskByPID(pid) {
        var r = this.searchTask(function (t) {
            return (t.pid == pid);
        });
        return r;
    }
    getRunningTaskByID(id) {
        var r = null;
        if (typeof this.runningTasks[id] != "undefined")
            r = this.runningTasks[id];
        return r;
    }
    checkTasks() {
        for (var id in this.runningTasks) {
            var task = this.runningTasks[id];
            if (this.pidIsRunning(task.pid)) {
                this.logger.debug("Task PID " + task.pid + " is running");
            }
            else {
                this.logger.info("Task PID " + task.pid + " is not running");
                if (typeof this.runningProcesses[task.id] == "undefined") {
                    task.exitCode = 999;
                    this.sendCallback(task, "END", function (error, task) {
                        this.removeTask(task.id);
                    }.bind(this));
                }
            }
        }
    }
    sendCallback(task, eventName, callback = null, attempts = 3) {
        var data = {
            task: task,
            event: "END",
            exitCode: task.exitCode
        };
        if (task.callback_url) {
            request.post(task.callback_url, {
                body: data,
                json: true,
                strictSSL: false,
                headers: {
                    'User-Agent': this.config.userAgent
                }
            }, function (error, response, body) {
                if (error) {
                    this.logger.error("Http POST error=" + error + ", url=" + task.callback_url);
                    if (attempts <= 1) {
                        if (callback)
                            callback(error, task);
                    }
                    else {
                        attempts--;
                        this.logger.info("sendCallback: Nouvelle tentative dans 10 sec ... ");
                        setTimeout(function () {
                            this.sendCallback(task, eventName, callback, attempts);
                        }.bind(this), 10000);
                    }
                }
                else {
                    if (response && (response.statusCode < 400)) {
                        this.logger.debug("Http POST OK: " + task.callback_url);
                        this.logger.debug("response=", body);
                        if (callback)
                            callback(null, task);
                    }
                    else {
                        this.logger.error("Http POST status=" + response.statusCode + ", body=" + body + ", url=" + task.callback_url);
                        if (attempts <= 1) {
                            if (callback)
                                callback("Http POST status=" + response.statusCode + ", body=" + body + ", url=" + task.callback_url, task);
                        }
                        else {
                            attempts--;
                            this.logger.info("sendCallback: Nouvelle tentative dans 10 sec ... ");
                            setTimeout(function () {
                                this.sendCallback(task, eventName, callback, attempts);
                            }.bind(this), 10000);
                        }
                    }
                }
            }.bind(this));
        }
        else {
            if (callback)
                callback(null, task);
        }
    }
    onRefreshTimer() {
        this.checkTasks();
    }
    _startTask(req, res) {
        try {
            var r = this.execTask(req.body);
        }
        catch (err) {
            this.logger.error(err);
            if (err.message)
                res.status(500).send("startTask: " + err.message);
            else
                res.status(500).send("startTask: " + err);
            return;
        }
        this.logger.info("/tasks/start");
        res.status(202).send(r);
    }
    _startTaskSync(req, res) {
        try {
            var r = this.execTask(req.body, function (error, task) {
                if (error) {
                    if (error.message)
                        res.status(500).send(error.message);
                    else
                        res.status(500).send(error);
                }
                else {
                    res.status(200).send(task);
                }
            }.bind(this));
        }
        catch (err) {
            this.logger.error(err);
            if (err.message)
                res.status(500).send("startSync: " + err.message);
            else
                res.status(500).send("startSync: " + err);
            return;
        }
    }
    _killTask(req, res) {
        try {
            var r = this.killTask(req.params.id);
        }
        catch (err) {
            this.logger.error(err);
            if (err.message)
                res.status(500).send("killTask: " + err.message);
            else
                res.status(500).send("killTask: " + err);
            return;
        }
        res.status(202).send(r);
    }
}
exports.TtasksManager = TtasksManager;
//# sourceMappingURL=TtasksManager.js.map