-- Wyłącznie syntetyczne środowisko lokalne; konto nie ma uprawnień superuser ani CREATEDB.
CREATE ROLE pap_test LOGIN PASSWORD 'pap_test_only';
CREATE DATABASE pap_test OWNER pap_test;
