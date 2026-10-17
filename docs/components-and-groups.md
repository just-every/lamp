# Components and groups

Open **Components** in the operator app. Add components for the services
customers need to see, then add groups when you want to organize those services
on the public page.

## Set up components

1. Choose **Add component** and enter its public name. Add an optional public
   description and state note, then choose a group or leave it ungrouped.
2. Mark a component **Internal only** when it should stay off the public page,
   Atom feed, widget, overall status and uptime figures.
3. Use **Move up** and **Move down** to set the displayed order. A component can
   belong to at most one group.
4. Use **Set status** for a standing operator status, or choose **Automatic**
   to clear that claim. Active incidents and in-progress maintenance can also
   claim a state; the public state is the most severe current claim.
5. Open **Status history** to review state changes or record a correction with
   its reason.

Group order and component order are reflected on the public page. Deleting a
component removes its public state history and uptime, while published incident
and maintenance updates keep its recorded name.

Public descriptions accept up to 500 characters and appear behind an **About**
disclosure that works without JavaScript. Set **Uptime start date** to exclude
earlier days from the displayed uptime calculation while keeping their history.
Choose **Show only when not Operational** for a service that customers need to
see only while affected. Its claims still count toward overall status. Recovery
hides its component row and uptime again without deleting either record.

## Edit the catalogue together

Choose **Bulk edit / import CSV** to edit component and group rows together.
Change names, descriptions, positions, groups, visibility or uptime dates, and
add or remove rows. Choose **Review changes** to see the counts and deletions;
the dry run writes nothing. **Apply reviewed changes** commits that catalogue.
A concurrent edit makes the review stale, so reload and review again.

**Import CSV** accepts a file or pasted contents. The required header is `name`;
the form lists the optional headers. Quote descriptions containing commas,
quotes or newlines. Rows without an ID add components; rows naming an existing
ID change it. Existing components stay unless an identified row says
`action=delete`. New group names create groups. Review before applying.
