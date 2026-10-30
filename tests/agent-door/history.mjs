// Isolated, insert-only native history for the disposable conformance host.
// The incident and its first publication come from the real native journey.
// Retain a separate due draft after that publication consumed its live draft;
// never UPDATE a live record or write protocol evidence. Incidents and component
// tables have triggers, so the history declaration deliberately cannot target them.
export default {
  async fetch(request) {
    const { args, outputs } = await request.json();
    const incident = outputs['incident-create']?.incident;
    const draft = incident?.draft;
    if (!draft) return new Response(null, { status: 422 });
    const due = incident.openedAt;
    return Response.json([
      { statement: 'draft', values: [args.id, args.id, draft.lifecycle,
        draft.affectedAudience, draft.customerImpact, draft.whatStillWorks,
        draft.details, draft.nextUpdateAt, draft.authorOperatorId, due, due,
        due, '[]', '[]'] },
    ]);
  },
};
