# Happy Deploy &middot; ![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg) [![npm version](https://img.shields.io/npm/v/e2e-happy-deploy.svg?style=flat)](https://www.npmjs.com/package/e2e-happy-deploy) 

# How to use
## Setup Environment
Install Node JS from [here](https://nodejs.org/en/download/)

## Install happy-deploy from NPM repository
```bash
npm install e2e-happy-deploy -g
happy-deploy
```

# Which resources will be deployed

In this tool, we will create several resources necessary for end to end diagnostics.
We will create a new resource group to hold all created resources.  
You can create a new IoT Hub or use existing one.  
Then diagnostics info will be exported to a place. There're 2 choices:

## Store the diagnostics info to Event Hub
If you choose to store the diagnostics info to Event Hub, the flow is like this.
![](doc/eventhub.png "Eventhub")

It will create an Event Hub, Application Insights, Storage account(for function app), Function app, and an Web App(For visualization, you can also choose to deploy on your own web server)

## Store the diagnostics info to Storage Account
If you choose to store the diagnostics info to Storage Account, the flow is like this.
![Storage](doc/storage.png)

It will create an Storage account, and an Web App(For visualization, you can also choose to deploy on your own web server)
