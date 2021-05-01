const express = require('express');
const app = express();
const cron = require('node-cron');
const fs = require("fs");
const fetch = require('node-fetch');
const nodemailer = require('nodemailer')
const dateLibrary = require('date-and-time');
app.use(express.json());

var subscribers, districts, config, transporter;

app.get('/', async function (req, res) {
  res.send('Hello World!');
});

// Subscribers Model
app.get('/subscribers', function (req, res) {
  res.send(subscribers);
});

app.post('/subscribers', function (req, res) {
  console.log(req.body);
  var subscriber = {
    "email": req.body.email,
    "district_id":  districts.districts.filter((district) => req.body.district == district.district_name)[0].district_id,
    "min_age": req.body["min_age"] != null ? req.body["min_age"] : 18,
    "notified": null
  }
  subscribers[req.body.email] = subscriber; 
  fs.writeFile( "./resources/subscribers.json", JSON.stringify(subscribers), (err) => {});
  res.send('User created');
});

// END: Subscribers Model


// Background job
cron.schedule(' */15 * * * *', async function() {
  await periodicJob();
});

async function periodicJob() {
  const subscribersByDistrict = Object.values(subscribers).reduce((acc, sub) => {
    // Group initialization
    if (!acc[sub.district_id]) {
      acc[sub.district_id] = [];
    }
   
    // Grouping
    acc[sub.district_id].push(sub);
   
    return acc;
  }, {});

  for (const [district_id, districtSubscribers] of Object.entries(subscribersByDistrict)) {
    
    if (districtSubscribers.some(notificationRequired)) {
      console.log(`Firing API for district_id: ${district_id}`);
      const res = await fetch(`https://cdn-api.co-vin.in/api/v2/appointment/sessions/public/calendarByDistrict?district_id=${district_id}&date=${dateLibrary.format(new Date(), "DD-MM-YYYY")}`, {
        "method": "GET",
      });
      const json = await res.json();
      if("centers" in json){
        let relevant_centers = getRelavantCenters(json.centers);
        if (relevant_centers.length > 0) {
          districtSubscribers.forEach((districtWiseSubscribers) => notify(districtWiseSubscribers, json.centers));
        } else {
          console.log(`No centers available for ${district_id}`);
        }
      } else {
        console.log(`APIError: Response did not contain centers\n${JSON.stringify(json, null, 2)}`)
      }
    }
  }
}

function notificationRequired(subscriber) {
  const today = dateLibrary.format(new Date(), "DD-MM-YYYY");
  return subscriber.notified == null || subscriber.notified != today;
}

function getRelavantCenters(centers) {
  relevant_centers = [];
  if (centers.length > 0) {
    centers.forEach(center => {
      if ("sessions" in center && center.sessions.some(session => session["available_capacity"] > 0)) {
        relevant_centers.push(center);
      }
    })
  } 
  return relevant_centers;
}

async function notify(subscriber, centers) {
  let message = "Following Centers are now available for booking.\n\n";
  let relevant_centers = centers.filter((center) => 
    center.sessions.some((session) => parseInt(subscriber.min_age) >= session.min_age_limit)
  );
  if (relevant_centers.length == 0) {
    console.log(`No centers found for subscriber: ${subscriber.email}`);
    return;
  }

  message+=(JSON.stringify(relevant_centers, null, 2) + "\n\n");
  if (notificationRequired(subscriber)) {
    sendMail(message, subscriber);
  }  
}

async function dummySendMail(message, subscriber) {
  console.log(`Sending email to ${subscriber.email} with Body \n ${message} \n\n END\n\n`);
  subscribers[subscriber.email]["notified"] = dateLibrary.format(new Date(), "DD-MM-YYYY");
  fs.writeFile( "./resources/subscribers.json", JSON.stringify(subscribers), (err) => {});
}

async function sendMail(message, subscriber) {
  console.log(`Sending email to ${subscriber.email}`)
  var mailOptions = {
    from: 'gr96den@gmail.com',
    to: subscriber.email,
    subject: 'COVID vaccine availability notification',
    text: message
  };
  transporter.sendMail(mailOptions, function(error, info){
    if (error) {
      console.log(error);
    } else {
      console.log('Email sent: ' + info.response);
      subscribers[subscriber.email]["notified"] = dateLibrary.format(new Date(), "DD-MM-YYYY"); 
      fs.writeFile( "./resources/subscribers.json", JSON.stringify(subscribers), (err) => {});
    }
  });  
}

app.listen(8089, function () {
  console.log('Example app listening on port 8089!');
  config = require("./resources/config.json");
  subscribers = require("./resources/subscribers.json");
  districts = require("./resources/districts.json");
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: config.username,
      pass: config.pasword
    }
  });
});