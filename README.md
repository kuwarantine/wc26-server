# World Cup 2026 Bracket Web App
[Live Application](https://wc26-bracket.pages.dev/) · [Frontend Repository](https://github.com/kuwarantine/wc26-client)

This is a discussion of the backend of my web app. For the overview and features, please visit the frontend repo.

## Architecture Overview
The backend of the app is built with Node.js and Express (original, I know). It's an easy and flexible setup, so I had no reason to change it up. I received data as Excel sheets, which I converted to CSVs and parsed to push to the Postgres instance. Match data was pulled from a third-party API during match times and after match completion. Scheduling was handled through pg-boss, a library for using Postgres as a scheduler. Postgres had a few interesting uses as explained below!

## API
I had a third-party API which provided me with live match data. I would send requests to it, parse the response, package it into the formats that my frontend or backend needed, and go from there. There are some limitations to the API though, such as not providing placeholder matches for knockout stages. I had to create my own placeholder matches and add them to my database, then connect any newly added matches in the API to the existing ones I had by comparing teams in the match from the API to the teams that my backend determined were through to the next round.

## Scoring
While I initially did a lot of the scoring on the backend itself, I eventually moved it to being done by the database. This was mainly to separate concerns and keep transactions atomic. I didn't want the server to go down halfway through point allocation and be in a state that needed a lot of manual interference. The scoring SQL statements are sent to the database, which would run the statement and assign points to any picks that earned them.

## Database
The database structure was normalized as much as possible, and contains tables storing information directly (such as users, picks, and events) and views that consolidated information so the backend could instantly serve the view data to the frontend (such as the leaderboards and live matches).

## Scheduling
This is where I had to be a little creative. The backend was being hosted on Heroku, which runs on ephemeral dynos (they're expected to restart approximately once a day). That meant any scheduled tasks (such as live match updates), needed to be persisted somehow. After considering solutions (including Redis and RabbitMQ), I opted for pg-boss, a scheduler that runs on top of Postgres. I obviously already had a Postgres instance, so why not use it for scheduling as well? It also provided some nice features such as automatic retries. I created a dedicated worker dyno that both scheduled tasks and processed them through pg-boss. I also ensured that it was idempotent, using singleton keys for matches and checking if fixtures are queued already before scheduling them.

## Live Matches
This is somewhere else I needed to consider Heroku's architecture. First of all, Heroku closes any connections after a given number of seconds (unless they are kept alive by sending some packets). Instead of constantly sending packets to the client when there was no live match, I just sent the client the time of the next live match, so it could re-establish the connection at the proper time.

As mentioned above, the match tracking was scheduled with pg-boss, where the worker would ping the third-party API every minute for match information (score, events, etc) and pause itself if necessary (half-time, suspension, etc). There are surprisingly a lot of edge cases to handle here, especially if you don't want to brute force things! Now as the worker and web dyno are separate processes, I couldn't share the live updates directly to the client (as the web dyno is the one that the client connected to). I used Postgres's LISTEN/NOTIFY feature to tell the web process that a specific match was updated, which it would then pull and send to the client.
