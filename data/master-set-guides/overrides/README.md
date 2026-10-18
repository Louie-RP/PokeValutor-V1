# Master set guide overrides

Add an optional `<expansion-id>.json` file only when Scrydex needs a reviewed correction.

```json
{
  "variantImageOverrides": {
    "me2pt5-7:cosmosHolofoil": {
      "small": "https://verified.example/image/small",
      "medium": "https://verified.example/image/medium",
      "large": "https://verified.example/image/large"
    }
  },
  "excludedSlots": [
    "me2pt5-7:normal"
  ]
}
```

Never guess a Scrydex image URL suffix. Only add an override after verifying the image and its usage rights.
