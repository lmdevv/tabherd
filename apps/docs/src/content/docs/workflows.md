---
title: Workflows
description: A few useful things to ask your agent to do with Tabherd.
---

Tell your agent the outcome you want. Tabherd gives it browser tools; the agent supplies the reasoning. Start by listing tabs and reading relevant pages.

## Tidy a workspace

> Group my research tabs by project. Keep pinned tabs where they are, and show me which duplicates you’d close.

The agent queries `tabs`, reads page content where useful, and uses `tabs.group` with `tabGroups.update` to name groups. Tab groups depend on browser support; separate windows work as an alternative.

## Save what matters

> Bookmark the useful articles in a “Reading” folder, then close the ones you saved.

The agent creates the folder and bookmarks with `bookmarks.create`, verifies them, then closes the requested tabs with `tabs.remove`.

## Move a project

> Put all the tabs for this project into a separate window, in the order I’ll need them.

The agent uses `windows.create` and `tabs.move`. It can update the window’s size and focus, or pin a reference tab with `tabs.update`.

## Understand open pages

> Read my open documentation tabs and tell me which one explains authentication.

The agent uses `browser_page` with `action: "read"`. It can follow links, search the page, and capture a screenshot when visual context helps.

## Work on a page

> Fill this form from my notes, then let me review it before submitting.

The agent reads the form, uses `type` and `select`, and reads again to verify the values. Chromium supports trusted input through the debugger; Firefox supports DOM interactions.

## Recover a tab

> Restore the tab I just closed.

The agent looks up `sessions.getRecentlyClosed` and calls `sessions.restore` with the matching session ID. Availability follows the browser’s session API.

Closing tabs, submitting forms, clearing browser data, and deleting bookmarks act on your real profile. Give your agent clear boundaries. Batch actions can partially succeed; inspect the result before repeating them.
