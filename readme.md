---
page_type: sample
languages:
- javascript
products:
- azure
description: "Help users create necessary resources to visualize the flow of IoT Hub messages through Application Map using Azure Functions and Event Hub."
name: "E2E diagnostic provision CLI"
urlFragment: cli-sample
---

# E2E diagnostic provision CLI &middot; ![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg) 

# Introduction
This CLI tool would help user create necessary resources to visualize the flow of IoT Hub messages through Application Map using Azure Function and Event Hub. It is powered by IoT Hub distributed tracing feature, and can help user easily do E2E diagnostic. If you want to learn more about distributed tracing of Azure IoT Hub, you can refer this tutorial: [Trace Azure IoT device-to-cloud messages with distributed tracing](https://aka.ms/iottracing)

# How to use
## Setup Environment
Make sure node version is not less than V7.6.0 (node -v)  
Install Node JS from [here](https://nodejs.org/en/download/)

### (Option 1) Install E2E diagnostic provision CLI from NPM repository
```bash
npm install e2e-diagnostic-provision-cli -g --registry=https://www.myget.org/F/e2e-diagnostic-provision-cli/npm

e2e-provision
```

### (Option 2) Compile and Run package locally
```
npm install
node e2e-provision.js
```

# Work flow of E2E diagnostic provision CLI
![](doc/flow.png)

# Which resources will be deployed

In this tool, we will create several resources necessary for end to end diagnostics.
We will create a new resource group to hold all created resources.  
You can create a new IoT Hub or use existing one.  
Then diagnostics info will be exported to Event Hub, and the flow is like this.
![](doc/eventhub.png "Eventhub")

It will create an Event Hub, Application Insights, Storage account(for function app), Function app

# Query logs

After exporting distributed tracing to Application Insights, you may query logs as you want, some sample queries are listed below:

## Query all logs

 ```sql
 requests | union dependencies | where id matches regex "^00-.*?-.*?-01$" | order by timestamp desc 
```

## Query all failed logs

```sql
requests | union dependencies | where success == "False" 
```

## Query all routing disabled logs

```sql
let logs = requests | union dependencies | where id matches regex "^00-.*?-.*?-01$" | extend traceId = substring(id, 0,35);
let RoutingDisabledlogsTraceId = logs | where customDimensions.isRoutingEnabled == "False" | project traceId;
logs | join kind = inner RoutingDisabledlogsTraceId on traceId | order by id
```

## Query logs with specific trace id

```sql
requests | union dependencies | where id matches regex "^00-.*?-.*?-01$" | extend traceId = substring(id, 3,32) | where traceId == "0CCEBFC39C3F848005CC31196A77B0BB"
```
## Query top 10 logs with maximum latency

```sql
requests | union dependencies | order by duration desc | take 10
```

## Query logs do not reach the last service, except routing disabled logs

```sql
let logs = requests | union dependencies | where id matches regex "^00-.*?-.*?-01$" | extend traceId = substring(id, 0,35);
let incompleteLogTraceId = logs | summarize logNum=count(traceId) by traceId | where logNum < 3;
let incompleteLogs = logs | join kind = inner incompleteLogTraceId on traceId;
let incompleteLogsWithRoutingDisabled = incompleteLogs | where customDimensions.isRoutingEnabled == "False" | project traceId = substring(id, 0,35);
let reachLastServiceLogTraceId = incompleteLogs | where name == "Egress Latency" | project traceId = substring(id, 0,35);
let notReachLastServiceLogTraceId = incompleteLogTraceId | join kind=leftanti reachLastServiceLogTraceId on traceId;
let notReachLastServiceLogTraceIdExceptRoutingDisabled = notReachLastServiceLogTraceId | join kind=leftanti incompleteLogsWithRoutingDisabled on traceId;
logs | join kind = inner notReachLastServiceLogTraceIdExceptRoutingDisabled on traceId | order by id 
```
