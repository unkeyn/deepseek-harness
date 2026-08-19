# dsh-credential-health

Provider-specific classification service for credential failures. It turns provider evidence into conservative health dispositions without inspecting secret values or owning retry behavior.

The DeepSeek classifier cools down rate limits, removes only confirmed invalid credentials, records model-only denial separately, and quarantines ambiguous `403` responses.

## Model Experience

None directly. Broker providers consume dispositions to change eligibility; no prompt or tool is registered.

## Known Limitations and Deferred Work

- The first implementation is a conservative DeepSeek classifier only.
- Durable cooldown, quarantine, rotation, and failover mutations are implemented by later broker policy providers.
