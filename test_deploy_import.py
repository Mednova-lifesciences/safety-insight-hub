import unittest


class DeployImportTest(unittest.TestCase):
    def test_server_module_imports_from_repo_root(self):
        import server.main
        self.assertTrue(hasattr(server.main, "app"))


if __name__ == "__main__":
    unittest.main()
