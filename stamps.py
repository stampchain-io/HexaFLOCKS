import os
import random
import json
import logging

logger = logging.getLogger(__name__)

try:
    # Optional import; available if user installs external/btc_stamps
    from btcstamps import StampCreator  # type: ignore
except Exception:  # pragma: no cover - optional dep
    StampCreator = None  # type: ignore


class StampService:
    """Wrapper around btc_stamps with a safe mock fallback.

    - If `btcstamps` is installed and a private key is provided, attempts real stamping.
    - If not available and ALLOW_MOCK_STAMP=true (default), returns a mock tx id.
    - If not available and ALLOW_MOCK_STAMP=false, raises RuntimeError.
    """

    def __init__(self, private_key: str | None, network: str = "testnet") -> None:
        self.private_key = private_key
        self.network = network
        self.allow_mock = os.getenv("ALLOW_MOCK_STAMP", "true").lower() == "true"
        self._creator = None

        if StampCreator and private_key:
            try:
                # StampCreator signature can vary across versions; keep this simple.
                self._creator = StampCreator(network=network, private_key=private_key)
                logger.info("btc_stamps StampCreator initialized")
            except Exception as e:  # pragma: no cover
                logger.warning(f"Failed to init StampCreator, falling back: {e}")
                self._creator = None
        else:
            if not StampCreator:
                logger.info("btc_stamps not installed; using mock stamping unless disabled")
            if not private_key:
                logger.info("No WALLET_PRIVATE_KEY provided; using mock stamping unless disabled")

    def estimate_fee(self, stamp_data: dict) -> int:
        """Rudimentary fee estimate. If real creator exists, try to call estimate.
        Otherwise return a simple constant.
        """
        if self._creator and hasattr(self._creator, "estimate_fee"):
            try:
                return int(self._creator.estimate_fee(stamp_data))  # type: ignore
            except Exception as e:  # pragma: no cover
                logger.warning(f"estimate_fee via btc_stamps failed: {e}")
        # Fallback nominal fee in sats
        return 1000

    def create_stamp(self, stamp_data: dict) -> str:
        """Create a stamp and return a transaction id/hash.

        Attempts:
          - _creator.create_stamp(stamp_data)
          - _creator.inscribe(stamp_data)
          - mock tx if allowed
        """
        # Serialize minimal stable payload for logging
        try:
            log_preview = json.dumps({k: stamp_data.get(k) for k in ("name", "description")})
            logger.info(f"Stamp request: {log_preview}")
        except Exception:
            logger.info("Stamp request: <unserializable>")

        if self._creator:
            try:
                if hasattr(self._creator, "create_stamp"):
                    return str(self._creator.create_stamp(stamp_data))  # type: ignore
                if hasattr(self._creator, "inscribe"):
                    return str(self._creator.inscribe(stamp_data))  # type: ignore
                raise RuntimeError("btc_stamps creator has no known stamp method")
            except Exception as e:  # pragma: no cover
                logger.error(f"Real stamping failed: {e}")
                if not self.allow_mock:
                    raise

        if not self.allow_mock:
            raise RuntimeError("Stamping unavailable and mock disabled")

        seed = stamp_data.get("attributes", {}).get("seed") or stamp_data.get("seed") or random.randint(1, 1_000_000)
        mock_tx = f"mock_tx_{seed}_{random.randint(100000,999999)}"
        logger.info(f"Returning mock tx: {mock_tx}")
        return mock_tx

