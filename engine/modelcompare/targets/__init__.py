from modelcompare.schema import TargetConfig
from modelcompare.targets.base import Target


def build_target(cfg: TargetConfig) -> Target:
    if cfg.kind == "mock":
        from modelcompare.targets.mock import MockTarget

        return MockTarget(cfg)
    from modelcompare.targets.litellm_target import LiteLLMTarget

    return LiteLLMTarget(cfg)


__all__ = ["Target", "build_target"]
