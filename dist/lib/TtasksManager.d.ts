/// <reference types="express" />
/// <reference types="bluebird" />
import * as turbine from 'turbine';
import TbaseService = turbine.services.TbaseService;
import Ttimer = turbine.tools.Ttimer;
import Promise = require("bluebird");
import ThttpServer = turbine.services.ThttpServer;
import express = require('express');
export declare class TtasksManager extends TbaseService {
    httpServer: ThttpServer;
    runningTasks: {};
    runningTasksDir: string;
    runningProcesses: {};
    refreshTimer: Ttimer;
    app: express.Application;
    constructor(name: any, server: any, config: any);
    getDefaultConfig(): {
        "active": boolean;
        "executionPolicy": string;
        "dataDir": string;
        "apiPath": string;
        "userAgent": string;
    };
    flatify(): Promise<{}>;
    start(): void;
    stop(): void;
    execTask(task: any, endCallback?: any): any;
    searchTask(f: any): any;
    killTask(id: string): void;
    fileExists(path: string): boolean;
    removeTask(id: string): void;
    saveTask(task: any): void;
    loadTasks(): void;
    pidIsRunning(pid: number): boolean | void;
    getRunningTaskByPID(pid: number): any;
    getRunningTaskByID(id: string): any;
    checkTasks(): void;
    sendCallback(task: any, eventName: string, callback?: any, attempts?: number): void;
    onRefreshTimer(): void;
    _startTask(req: express.Request, res: express.Response): void;
    _startTaskSync(req: express.Request, res: express.Response): void;
    _killTask(req: express.Request, res: express.Response): void;
}