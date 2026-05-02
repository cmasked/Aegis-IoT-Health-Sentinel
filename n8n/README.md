# n8n Workflow Setup

## Files

- `aegis_closed_loop_workflow.json`: Import this into n8n.
- `sample_payload_critical.json`: Use this payload for a critical incident test run.

## Import Steps

1. Open n8n.
2. Go to **Workflows** -> **Import from File**.
3. Select `aegis_closed_loop_workflow.json`.
4. Save and activate the workflow.

## Run a Test

1. Open the **Webhook Ingest** node and copy the test URL.
2. Send a POST request with JSON body from `sample_payload_critical.json`.
3. Run once and open execution data for screenshot capture.

## Expected Outcome

- Incident is triaged as `CRITICAL` for the sample payload.
- Interventions are created.
- Verification detects missing proof.
- State becomes `escalated` with `nextAction` set for backup chain.
